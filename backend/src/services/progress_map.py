"""Daten für die 2,5D-Gebäudeansicht im Baufortschritt (Kern von GET /api/progress/building).

Liefert NICHT den Zustand eines Stichtags, sondern alles, was das Frontend braucht, um jeden Tag
selbst auszurechnen (Zeitregler ohne Nachladen):
- je Vorgang: Plan (Start/Ende/Dauer in Werktagen), gemeldete Fortschritte aus Tagesberichten,
  Ort zerlegt in Haus + Ebene,
- Ereignisse mit Datum und Ort: Mängel (Mängelrügen, Bedenken, Notizen „defect“), Behinderungen
  (Behinderungsanzeigen), Vorkommnisse aus Tagesberichten, Foto-Befunde.
Die Soll/Ist-Formeln sind dieselben wie in services/analysis.py (das Frontend rechnet sie nach).

Ort erkennen: "Haus B · UG (Achse A)" → ("Haus B", "UG"). Fehlt das Haus, hilft die Achse
(aus anderen Vorgängen gelernt: "Achse A" gehört zu "Haus B"); fehlt die Ebene, der Vorgang,
der an dem Tag in dem Haus lief.
"""

import datetime as dt
import json
import re

from sqlmodel import Session, select

from src.models import (
    Contract,
    DailyReport,
    FormalNotice,
    NoticeDraftData,
    PlanTask,
    Project,
    ReportProgress,
    SiteNote,
    SitePhoto,
)
from src.schemas.progress import BuildingEvent, BuildingProgress, BuildingTask, ProgressPoint
from src.services.analysis import duration
from src.services.letters import TYPE_NAMES
from src.services.reports import project_tasks
from src.services.summary import note_label, notice_label, report_label

BASE_LEVELS = ["Gründung", "UG", "EG"]
TOP_LEVEL = "Dach"

_HOUSE_RX = re.compile(r"\b(?:Haus|Gebäude|Bauteil|BT)\s+([A-Z0-9]{1,3})\b", re.I)
_AXIS_RX = re.compile(r"\bAchse\s+([A-Z0-9]{1,3})\b", re.I)
_OG_RX = re.compile(r"\b(\d{1,2})\s*\.\s*(?:OG|Obergeschoss)\b", re.I)
_LEVEL_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\b(Dach\w*|Attika)\b", re.I), TOP_LEVEL),
    (re.compile(r"\b(UG|KG|Untergeschoss|Keller\w*|Tiefgarage)\b", re.I), "UG"),
    (re.compile(r"\b(EG|Erdgeschoss)\b", re.I), "EG"),
    (re.compile(r"\b(Gründung|Fundament\w*|Bodenplatte|Aushub|Baugrube\w*|Sockel\w*|Verbau)\b", re.I), "Gründung"),
]


def parse_house(text: str | None, axis_houses: dict[str, str] | None = None) -> str | None:
    if not text:
        return None
    m = _HOUSE_RX.search(text)
    if m:
        return f"Haus {m.group(1).upper()}"
    m = _AXIS_RX.search(text)
    if m and axis_houses:
        return axis_houses.get(m.group(1).upper())
    return None


def parse_level(text: str | None) -> str | None:
    if not text:
        return None
    m = _OG_RX.search(text)
    if m:
        return f"{int(m.group(1))}.OG"
    for rx, level in _LEVEL_RULES:
        if rx.search(text):
            return level
    return None


def level_order(levels: set[str]) -> list[str]:
    ogs = sorted((lv for lv in levels if lv.endswith(".OG")), key=lambda lv: int(lv.split(".")[0]))
    out = [lv for lv in BASE_LEVELS if lv in levels] + ogs
    if TOP_LEVEL in levels:
        out.append(TOP_LEVEL)
    return out


def _axis_houses(tasks: list[PlanTask]) -> dict[str, str]:
    """Achse → Haus aus Orten wie "Haus B · UG (Achse A)" oder "Achse A (Haus B)"."""
    mapping: dict[str, str] = {}
    for t in tasks:
        text = f"{t.location or ''} {t.title}"
        house, axis = _HOUSE_RX.search(text), _AXIS_RX.search(text)
        if house and axis:
            mapping.setdefault(axis.group(1).upper(), f"Haus {house.group(1).upper()}")
    return mapping


def _task_place(t: PlanTask, axis_houses: dict[str, str]) -> tuple[str | None, str | None]:
    house = parse_house(t.location, axis_houses) or parse_house(t.title, axis_houses)
    level = parse_level(t.location) or parse_level(t.title)
    if house and not level:
        level = "EG"
    return house, level


def _running_on(tasks: list[BuildingTask], house: str | None, day: dt.date) -> list[BuildingTask]:
    """Vorgänge im Haus, die am Tag laut Plan liefen oder einen Fortschritt gemeldet bekamen."""
    out = []
    for t in tasks:
        if house and t.house != house:
            continue
        reported = any(p.date == day for p in t.history)
        planned = t.plannedStart and t.plannedEnd and t.plannedStart <= day <= t.plannedEnd
        if reported or planned:
            out.append(t)
    return out


def _place_event(text: str, day: dt.date, tasks: list[BuildingTask], axis_houses: dict[str, str],
                 touched: list[int] | None = None) -> tuple[str | None, str | None, list[int]]:
    """Ort eines Ereignisses: aus dem Text, sonst aus den an dem Tag bearbeiteten Vorgängen."""
    house, level = parse_house(text, axis_houses), parse_level(text)
    by_id = {t.id: t for t in tasks}
    candidates = [by_id[i] for i in (touched or []) if i in by_id and by_id[i].house]
    if house:
        candidates = [t for t in candidates if t.house == house] or _running_on(tasks, house, day)
    elif not candidates:
        candidates = []
    if level:
        candidates = [t for t in candidates if t.level == level] or candidates
    if not house and candidates:
        house = candidates[0].house
    if not level and candidates:
        level = candidates[0].level
    if house and not level:
        level = next((t.level for t in tasks if t.house == house), None)
    task_ids = [t.id for t in candidates if t.house == house and (not level or t.level == level)]
    if not task_ids and house and level:
        # z. B. Mangel an bereits fertiger Leistung: alle bis dahin begonnenen Vorgänge dieser Ebene
        task_ids = [t.id for t in tasks if t.house == house and t.level == level
                    and (t.plannedStart is None or t.plannedStart <= day)]
    return house, level, task_ids


def _notice_location(session: Session, notice: FormalNotice) -> str:
    data = session.exec(select(NoticeDraftData).where(NoticeDraftData.notice_id == notice.id)).first()
    if data and data.fields_json:
        try:
            fields = json.loads(data.fields_json)
            loc = (fields.get("location") or {}).get("value")
            if loc:
                return str(loc)
        except (ValueError, AttributeError):
            pass
    return f"{notice.subject or ''} {notice.title or ''} {notice.body[:600]}"


def build(session: Session, project: Project) -> BuildingProgress:
    plan_tasks = project_tasks(session, project.id)
    axis_houses = _axis_houses(plan_tasks)
    contracts = session.exec(select(Contract).where(Contract.project_id == project.id)).all()
    by_trade = {(c.trade or "").lower(): c.contractor_name or "" for c in contracts if c.trade}

    # Fortschritte aller Vorgänge in einer Abfrage
    rows = session.exec(
        select(ReportProgress, DailyReport).join(DailyReport, ReportProgress.report_id == DailyReport.id)
        .where(DailyReport.project_id == project.id).order_by(DailyReport.report_date)
    ).all()
    history: dict[int, list[ProgressPoint]] = {}
    touched_by_day: dict[dt.date, list[int]] = {}
    for prog, report in rows:
        history.setdefault(prog.task_id, []).append(ProgressPoint(date=report.report_date, percent=prog.percent))
        touched_by_day.setdefault(report.report_date, []).append(prog.task_id)

    tasks: list[BuildingTask] = []
    for t in plan_tasks:
        house, level = _task_place(t, axis_houses)
        tasks.append(BuildingTask(
            id=t.id, planId=t.plan_id, code=t.task_code, title=t.title, trade=t.trade or "",
            company=by_trade.get((t.trade or "").lower(), ""), location=t.location, house=house, level=level,
            plannedStart=t.planned_start, plannedEnd=t.planned_end, durationDays=duration(t),
            history=history.get(t.id, []), actualEnd=t.actual_end,
        ))

    events: list[BuildingEvent] = []
    # Briefe: Mängel/Bedenken = Mangel, Behinderung/Mehrkosten = Behinderung
    for n in session.exec(select(FormalNotice).where(FormalNotice.project_id == project.id)).all():
        kind = "defect" if n.type in ("defect", "concern") else "hindrance"
        day = n.created_at.date()
        house, level, ids = _place_event(_notice_location(session, n), day, tasks, axis_houses)
        events.append(BuildingEvent(
            id=f"notice-{n.id}", kind=kind, date=day, title=n.title or n.subject or TYPE_NAMES.get(n.type, n.type),
            detail=(n.subject or "")[:300], house=house, level=level, taskIds=ids, source=notice_label(n),
            noticeId=n.id, status=n.status,
        ))
    # Vorkommnisse aus Tagesberichten
    reports = session.exec(select(DailyReport).where(DailyReport.project_id == project.id)
                           .order_by(DailyReport.report_date)).all()
    for r in reports:
        text = (r.deviations_incidents or "").strip()
        if not text:
            continue
        house, level, ids = _place_event(text, r.report_date, tasks, axis_houses, touched_by_day.get(r.report_date))
        events.append(BuildingEvent(
            id=f"report-{r.id}", kind="incident", date=r.report_date, title=text.split(".")[0][:120],
            detail=text[:400], house=house, level=level, taskIds=ids, source=report_label(r),
            reportDate=r.report_date,
        ))
    # Foto-Befunde
    for p in session.exec(select(SitePhoto).where(SitePhoto.project_id == project.id)).all():
        try:
            issues = [str(i) for i in json.loads(p.issues_json or "[]") if str(i).strip()]
        except ValueError:
            issues = []
        if not issues:
            continue
        text = f"{p.caption or ''} {' '.join(issues)}"
        house, level, ids = _place_event(text, p.report_date, tasks, axis_houses, touched_by_day.get(p.report_date))
        events.append(BuildingEvent(
            id=f"photo-{p.id}", kind="photo", date=p.report_date, title=p.caption or issues[0],
            detail="; ".join(issues)[:400], house=house, level=level, taskIds=ids,
            source=f"Foto {p.report_date.strftime('%d.%m.%Y')}", photoId=p.id, reportDate=p.report_date,
        ))
    # Diktierte Mängel (Notizen mit Kategorie "defect")
    for n in session.exec(select(SiteNote).where(SiteNote.project_id == project.id,
                                                 SiteNote.category == "defect")).all():
        day = n.created_at.date()
        house, level, ids = _place_event(n.content, day, tasks, axis_houses, touched_by_day.get(day))
        events.append(BuildingEvent(
            id=f"note-{n.id}", kind="defect", date=day, title=n.content.split(".")[0][:120], detail=n.content[:400],
            house=house, level=level, taskIds=ids, source=note_label(n),
        ))
    events.sort(key=lambda e: (e.date, e.id))

    houses = sorted({t.house for t in tasks if t.house} | {e.house for e in events if e.house})
    levels = level_order({t.level for t in tasks if t.level} | {e.level for e in events if e.level})
    dates = [d for t in tasks for d in (t.plannedStart, t.plannedEnd) if d] + [r.report_date for r in reports]
    if project.start_date:
        dates.append(project.start_date)
    return BuildingProgress(
        projectId=project.id, houses=houses, levels=levels,
        rangeFrom=min(dates) if dates else None, rangeTo=max(dates) if dates else None,
        lastReportDate=reports[-1].report_date if reports else None,
        tasks=tasks, events=events,
    )

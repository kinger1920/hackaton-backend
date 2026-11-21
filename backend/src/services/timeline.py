"""Timeline der Baustelle (Board: "Timeline API: Fotos, Berichte, Mängel – Vergangenheit").

Sammelt chronologisch, jeweils mit Quelle:
- report:   Tagesberichte (Leistung, Personal, Wetter; Vorkommnis → Warnung)
- note:     Diktate/Notizen (SiteNote)
- notice:   Briefe – erstellt, freigegeben (wer/wann), exportiert
- progress: gemeldeter Fortschritt je Vorgang (vorher → nachher)
- alert:    Sollstärke-Unterschreitung (erster Tag einer Serie) und neu entstandener Verzug
Fotos/Mängel (Yannick) kommen als weitere Sammelfunktion dazu, sobald ihre Tabellen auf main sind.
"""

import datetime as dt
from collections.abc import Callable

from sqlmodel import Session, select

from src.models import DailyReport, FormalNotice, NoticeDraftData, PlanTask, Project, ReportProgress, SiteNote
from src.schemas.timeline import Timeline, TimelineItem
from src.services.analysis import delay_days, plan_percent
from src.services.letters import TYPE_NAMES
from src.services.reports import project_tasks, weather_text
from src.services.workforce import attendance_of, workforce_check

NOTE_TITLES = {"delay": "Diktat: Behinderung", "incident": "Diktat: Vorkommnis", "weather": "Diktat: Wetter",
               "progress": "Diktat: Fortschritt", "defect": "Diktat: Mangel", "general": "Notiz"}


def _de(d: dt.date) -> str:
    return d.strftime("%d.%m.%Y")


def _utc(ts: dt.datetime) -> dt.datetime:
    return ts if ts.tzinfo else ts.replace(tzinfo=dt.timezone.utc)


def _short(text: str | None, n: int = 160) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def _reports(session: Session, project: Project, start: dt.date, end: dt.date) -> list[DailyReport]:
    return list(session.exec(select(DailyReport).where(
        DailyReport.project_id == project.id, DailyReport.report_date >= start, DailyReport.report_date <= end)
        .order_by(DailyReport.report_date)).all())


def _collect_reports(session: Session, project: Project, start: dt.date, end: dt.date) -> list[TimelineItem]:
    items = []
    for r in _reports(session, project, start, end):
        facts = [f for f in (f"{r.workforce_count} Personen" if r.workforce_count is not None else None,
                             weather_text(r.weather)) if f]
        summary = _short(r.work_completed) or "Keine Leistung eingetragen."
        if facts:
            summary += f" ({', '.join(facts)})"
        if (r.deviations_incidents or "").strip():
            summary += f" Vorkommnis: {_short(r.deviations_incidents, 120)}"
        number = f" Nr. {r.report_number}" if r.report_number else ""
        items.append(TimelineItem(
            id=f"report-{r.id}", type="report", date=r.report_date, title=f"Bautagesbericht{number}",
            summary=summary, source=f"Tagesbericht {_de(r.report_date)}", refId=r.id,
            severity="warning" if (r.deviations_incidents or "").strip() else "info"))
    return items


def _collect_notes(session: Session, project: Project, start: dt.date, end: dt.date) -> list[TimelineItem]:
    items = []
    for n in session.exec(select(SiteNote).where(SiteNote.project_id == project.id)).all():
        ts = _utc(n.created_at)
        if not start <= ts.date() <= end:
            continue
        items.append(TimelineItem(
            id=f"note-{n.id}", type="note", date=ts.date(), time=f"{ts:%H:%M}",
            title=NOTE_TITLES.get(n.category or "general", "Notiz"), summary=_short(n.content),
            source=f"Notiz #{n.id} vom {_de(ts.date())}", refId=n.id,
            severity="warning" if n.category in ("delay", "incident", "defect") else "info"))
    return items


def _collect_notices(session: Session, project: Project, start: dt.date, end: dt.date) -> list[TimelineItem]:
    items = []
    for n in session.exec(select(FormalNotice).where(FormalNotice.project_id == project.id)).all():
        kind = TYPE_NAMES.get(n.type, "Schreiben")
        source = f"Schreiben #{n.id} {kind}"
        events = [("created", _utc(n.created_at), f"Entwurf erstellt: {kind}", _short(n.subject or n.title or n.body))]
        data = session.exec(select(NoticeDraftData).where(NoticeDraftData.notice_id == n.id)).first()
        if data and data.approved_at:
            events.append(("approved", _utc(data.approved_at), f"Freigegeben: {kind}",
                           f"Freigabe durch {data.approved_by or 'unbekannt'}."))
        if n.status == "Exportiert":
            events.append(("exported", _utc(n.updated_at), f"Exportiert: {kind}", "Als PDF/Word heruntergeladen."))
        for key, ts, title, summary in events:
            if start <= ts.date() <= end:
                items.append(TimelineItem(id=f"notice-{n.id}-{key}", type="notice", date=ts.date(),
                                          time=f"{ts:%H:%M}", title=title, summary=summary, source=source,
                                          refId=n.id, severity="info"))
    return items


def _collect_progress(session: Session, project: Project, start: dt.date, end: dt.date) -> list[TimelineItem]:
    """Fortschritt je Vorgang mit Vorher-Wert (letzter Stand vor diesem Bericht) – nur echte Änderungen."""
    items = []
    for task in project_tasks(session, project.id):
        rows = session.exec(
            select(ReportProgress, DailyReport).join(DailyReport, ReportProgress.report_id == DailyReport.id)
            .where(ReportProgress.task_id == task.id, DailyReport.report_date <= end)
            .order_by(DailyReport.report_date)).all()
        before = 0
        for p, r in rows:
            if r.report_date >= start and p.percent != before:
                items.append(TimelineItem(
                    id=f"progress-{r.id}-{task.id}", type="progress", date=r.report_date,
                    title=f"{task.title}: {before} % → {p.percent} %",
                    summary=f"{task.task_code or ''} Soll am Tagesende {plan_percent(task, r.report_date)} %.".strip(),
                    source=f"Tagesbericht {_de(r.report_date)}", refId=r.id,
                    severity="info" if p.percent >= plan_percent(task, r.report_date) else "warning"))
            before = p.percent
    return items


def _delay_on(session: Session, task: PlanTask, day: dt.date) -> float:
    rows = session.exec(
        select(ReportProgress, DailyReport).join(DailyReport, ReportProgress.report_id == DailyReport.id)
        .where(ReportProgress.task_id == task.id, DailyReport.report_date <= day)
        .order_by(DailyReport.report_date)).all()
    actual = 100 if task.actual_end and task.actual_end <= day else (rows[-1][0].percent if rows else 0)
    return delay_days(task, plan_percent(task, day), actual)


def _collect_alerts(session: Session, project: Project, start: dt.date, end: dt.date) -> list[TimelineItem]:
    """Warnungen nur am ersten Tag einer Serie (sonst stünde jeden Tag dasselbe drin)."""
    items = []
    for r in _reports(session, project, start, end):
        if not attendance_of(r):
            continue
        for g in workforce_check(session, project, r.report_date):
            if g.consecutiveDays == 1:
                items.append(TimelineItem(
                    id=f"alert-workforce-{r.id}-{g.contractId}", type="alert", date=r.report_date,
                    title=f"Sollstärke unterschritten: {g.company or g.trade}",
                    summary=f"{g.actual} statt {g.planned} Arbeitskräfte laut {g.contractSource} (−{g.shortfallPercent} %).",
                    source=g.source, refId=r.id, severity="warning"))
    # Verzug: Tag, an dem ein Vorgang erstmals ≥ 1 Arbeitstag hinter dem Plan liegt.
    for task in project_tasks(session, project.id):
        for r in _reports(session, project, start, end):
            day = r.report_date
            if _delay_on(session, task, day) >= 1 and _delay_on(session, task, day - dt.timedelta(days=1)) < 1:
                delay = f"{_delay_on(session, task, day):.1f}".replace(".", ",")
                items.append(TimelineItem(
                    id=f"alert-delay-{task.id}-{day.isoformat()}", type="alert", date=day,
                    title=f"Verzug: {task.title}", summary=f"{delay} Arbeitstage hinter dem Bauzeitenplan.",
                    source=f"Tagesbericht {_de(day)}", refId=r.id, severity="critical"))
                break
    return items


# Reihenfolge = Reihenfolge innerhalb eines Tages ohne Uhrzeit. Fotos/Mängel kommen hier dazu.
COLLECTORS: dict[str, Callable[[Session, Project, dt.date, dt.date], list[TimelineItem]]] = {
    "report": _collect_reports, "note": _collect_notes, "notice": _collect_notices,
    "progress": _collect_progress, "alert": _collect_alerts,
}


def timeline(session: Session, project: Project, start: dt.date, end: dt.date, types: list[str]) -> Timeline:
    """Alle Ereignisse im Zeitraum, neueste zuerst (gleicher Tag: mit Uhrzeit vor ohne, dann nach Typ)."""
    items: list[TimelineItem] = []
    for name in types:
        items += COLLECTORS[name](session, project, start, end)
    order = {name: i for i, name in enumerate(COLLECTORS)}
    step = {"created": 0, "approved": 1, "exported": 2}  # Brief-Schritte in derselben Minute
    items.sort(key=lambda i: (i.date, i.time or "", -order[i.type], step.get(i.id.rsplit("-", 1)[-1], 0)),
               reverse=True)
    return Timeline(projectId=project.id, dateFrom=start, dateTo=end, items=items)

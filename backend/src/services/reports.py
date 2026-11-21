"""Tagesberichte: lesen, speichern, per Diktat ergänzen (/fill) – inkl. Fortschritt je Vorgang.

Mapping Formular ↔ Datenbank:
- weather (Text)      ↔ DailyReport.weather als JSON {"condition": text}
- trades (Liste)      ↔ DailyReport.trades als JSON-Liste
- progress (Liste)    ↔ Tabelle ReportProgress (ein Eintrag je Bericht + Vorgang)

/fill: Die KI ordnet ein Diktat den Berichtsfeldern und den Vorgängen des Projektplans zu.
Der Code prüft alles (bekannte Vorgänge, 0–100 %), leere KI-Felder überschreiben nichts,
Text wird angehängt. Ohne KI greifen Regeln (Schlüsselwörter, "… 60 %").
"""

import datetime as dt
import json
import re
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from src.models import ConstructionPlan, DailyReport, PlanTask, Project, ReportProgress, SiteNote
from src.schemas.reports import FillRequest, FillResponse, ProgressOut, ReportIn, ReportOut
from src.services import llm, offline_rules

# Schlüsselwörter für Vorkommnisse (Behinderung, Mehrkosten, Mangel) aus den Offline-Regeln.
_INCIDENT_WORDS = [w for t in ("delay", "cost", "defect") for w in offline_rules.KEYWORDS[t]]
_PERCENT_RE = re.compile(r"(\d{1,3})\s*(?:%|prozent|procent)", re.IGNORECASE)


# ---------------------------------------------------------------- Hilfen

def resolve_project(session: Session, project_id: int | None) -> Project:
    """Projekt per ID (404, wenn unbekannt) oder – ohne Angabe – das erste Projekt."""
    if project_id is not None:
        project = session.get(Project, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail=f"Projekt {project_id} nicht gefunden")
        return project
    project = session.exec(select(Project).order_by(Project.id)).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Kein Projekt vorhanden")
    return project


def project_tasks(session: Session, project_id: int) -> list[PlanTask]:
    """Alle Vorgänge aus den Projektplänen des Projekts."""
    return list(session.exec(
        select(PlanTask).join(ConstructionPlan, PlanTask.plan_id == ConstructionPlan.id)
        .where(ConstructionPlan.project_id == project_id).order_by(PlanTask.planned_start, PlanTask.id)
    ).all())


def find_report(session: Session, project_id: int, date: dt.date) -> DailyReport | None:
    return session.exec(select(DailyReport).where(
        DailyReport.project_id == project_id, DailyReport.report_date == date)).first()


def _json(value: str | None):
    try:
        return json.loads(value) if value else None
    except (ValueError, TypeError):
        return None


def weather_text(value: str | None) -> str | None:
    """Wetter aus DB als Text: JSON {"condition", "temp_c"} → "bewölkt, 8 °C", sonst Rohtext."""
    data = _json(value)
    if isinstance(data, dict):
        parts = [str(data["condition"])] if data.get("condition") else []
        if data.get("temp_c") is not None:
            parts.append(f"{data['temp_c']} °C")
        return ", ".join(parts) or None
    return value or None


def _workforce_count(report: DailyReport) -> int | None:
    """Personal gesamt: eigene Spalte, sonst Summe aus dem workforce-JSON (Seed/Altdaten)."""
    if report.workforce_count is not None:
        return report.workforce_count
    crews = _json(report.workforce)
    if isinstance(crews, list):
        return sum(int(c.get("workers") or 0) for c in crews if isinstance(c, dict)) or None
    return None


def to_out(session: Session, project_id: int, date: dt.date, report: DailyReport | None) -> ReportOut:
    """DB-Bericht (oder None = noch nicht gespeichert) → API-Form."""
    if report is None:
        return ReportOut(id=None, project_id=project_id, report_date=date, report_number=None, weather=None,
                         workforce_count=None, trades=[], work_completed=None, deviations_incidents=None,
                         deliveries=None, summary=None, status="draft", progress=[])
    trades = _json(report.trades)
    rows = session.exec(
        select(ReportProgress, PlanTask).join(PlanTask, ReportProgress.task_id == PlanTask.id)
        .where(ReportProgress.report_id == report.id).order_by(PlanTask.planned_start, PlanTask.id)
    ).all()
    return ReportOut(
        id=report.id, project_id=report.project_id, report_date=report.report_date,
        report_number=report.report_number, weather=weather_text(report.weather),
        workforce_count=_workforce_count(report), trades=trades if isinstance(trades, list) else [],
        work_completed=report.work_completed, deviations_incidents=report.deviations_incidents,
        deliveries=report.deliveries, summary=report.summary, status=report.status,
        progress=[ProgressOut(task_id=t.id, task_code=t.task_code, title=t.title, percent=p.percent,
                              source=p.source, note=p.note) for p, t in rows],
    )


def _set_progress(session: Session, report: DailyReport, task_id: int, percent: int, source: str,
                  note: str | None = None) -> None:
    row = session.exec(select(ReportProgress).where(
        ReportProgress.report_id == report.id, ReportProgress.task_id == task_id)).first()
    if row is None:
        row = ReportProgress(report_id=report.id, task_id=task_id, percent=percent, source=source, note=note)
    else:
        row.percent, row.source, row.note = percent, source, note
    session.add(row)


def _get_or_create(session: Session, project_id: int, date: dt.date) -> DailyReport:
    report = find_report(session, project_id, date)
    if report is None:
        report = DailyReport(project_id=project_id, report_date=date, status="draft")
        session.add(report)
        session.flush()  # ID für ReportProgress
    return report


# ---------------------------------------------------------------- PUT

def upsert(session: Session, project: Project, date: dt.date, data: ReportIn) -> ReportOut:
    """Speichert den kompletten Formularstand. Fremde Vorgänge (anderes Projekt) → 422."""
    valid_ids = {t.id for t in project_tasks(session, project.id)}
    if data.progress is not None:
        unknown = sorted({p.task_id for p in data.progress} - valid_ids)
        if unknown:
            # 422: Eingabe ist formal gültig, verweist aber auf Vorgänge, die nicht zum Projekt gehören.
            raise HTTPException(status_code=422, detail={"unknown_task_ids": unknown})

    report = _get_or_create(session, project.id, date)
    report.report_number = data.report_number
    report.weather = json.dumps({"condition": data.weather}, ensure_ascii=False) if data.weather else None
    report.workforce_count = data.workforce_count
    report.trades = json.dumps(data.trades, ensure_ascii=False) if data.trades else None
    report.work_completed = data.work_completed
    report.deviations_incidents = data.deviations_incidents
    report.deliveries = data.deliveries
    report.summary = data.summary
    report.status = data.status
    report.updated_at = dt.datetime.now(dt.timezone.utc)
    session.add(report)

    if data.progress is not None:
        keep = {p.task_id for p in data.progress}
        for row in session.exec(select(ReportProgress).where(ReportProgress.report_id == report.id)).all():
            if row.task_id not in keep:
                session.delete(row)
        for p in data.progress:
            _set_progress(session, report, p.task_id, p.percent, "nutzer", p.note)

    session.commit()
    session.refresh(report)
    return to_out(session, project.id, date, report)


# ---------------------------------------------------------------- /fill

class _LLMProgress(BaseModel):
    task_code: str
    percent: int


class _LLMFill(BaseModel):
    work_completed: str
    deviations_incidents: str
    deliveries: str
    weather: str
    workforce_count: str
    trades: list[str]
    progress: list[_LLMProgress]


FILL_PROMPT = """Du füllst den Bautagesbericht eines deutschen Bauleiters aus einem Diktat.
Das Diktat kann in jeder Sprache sein (z. B. Polnisch) – schreibe ALLE Werte auf Deutsch.

Felder (unbekannt = leerer String bzw. leere Liste, NIE etwas erfinden):
- work_completed: ausgeführte Arbeiten / Tagesleistung als ganze Sätze, inkl. Fortschrittsangaben
  (z. B. "Aushub Achse B zu 80 % fertiggestellt."). Gewerke/Firmen gehören NICHT hierher, sondern in trades.
- deviations_incidents: Behinderungen, Stillstand, Verzug, Mängel, Unfälle, Mehrkosten.
- deliveries: Lieferungen, Abnahmen, Prüfungen.
- weather: Wetter, nur wenn genannt.
- workforce_count: Anzahl Personen auf der Baustelle als Ziffern, nur wenn genannt.
- trades: genannte Gewerke/Firmen auf der Baustelle (z. B. ["Erdbau", "Rohbau"]).
- progress: Fertigstellungsgrad in Prozent NUR für Vorgänge aus der Vorgangsliste, deren
  Prozentwert im Diktat ausdrücklich genannt wird ("fertig"/"abgeschlossen" = 100).
  task_code genau wie in der Liste."""


def _append(old: str | None, new: str) -> str | None:
    """Text anhängen statt ersetzen; doppelte Sätze vermeiden."""
    new = (new or "").strip()
    if not new:
        return old
    if old and new in old:
        return old
    return f"{old.rstrip()}\n{new}" if old and old.strip() else new


def _task_list(tasks: list[PlanTask]) -> str:
    return "\n".join(f"- {t.task_code or t.id}: {t.title}" for t in tasks) or "(kein Projektplan vorhanden)"


def _code(task: PlanTask) -> str:
    return (task.task_code or str(task.id)).strip()


def _offline_fill(text: str, tasks: list[PlanTask]) -> dict:
    """Regeln ohne KI: Sätze mit Störungs-Wörtern → Vorkommnisse, Rest → Leistung, "Titel … NN %" → Fortschritt."""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?;])\s+|\n+", text) if s.strip()]
    incidents = [s for s in sentences if any(w in s.lower() for w in _INCIDENT_WORDS)]
    work = [s for s in sentences if s not in incidents]
    progress = []
    for s in sentences:
        m = _PERCENT_RE.search(s)
        if not m:
            continue
        lower = s.lower()
        for t in tasks:
            if t.title.lower() in lower or (t.task_code and t.task_code.lower() in lower):
                progress.append({"task_code": _code(t), "percent": int(m.group(1))})
    return {"work_completed": " ".join(work), "deviations_incidents": " ".join(incidents), "deliveries": "",
            "weather": "", "workforce_count": "", "trades": [], "progress": progress}


async def fill(session: Session, project: Project, date: dt.date, req: FillRequest) -> FillResponse:
    """Diktat → Bericht des Tages ergänzen (+ Tagebucheintrag). Status bleibt 'draft' (Freigabe durch Nutzer)."""
    tasks = project_tasks(session, project.id)
    by_code = {_code(t).lower(): t for t in tasks}

    user = f"Vorgangsliste des Projektplans:\n{_task_list(tasks)}\n\nDiktat ({req.lang}):\n{req.text.strip()}"
    result = await llm.complete_json(FILL_PROMPT, user, _LLMFill, max_tokens=1200)
    mode: Literal["ai", "offline"] = "ai"
    if result is None:
        data, mode, source = _offline_fill(req.text, tasks), "offline", "regel"
    else:
        data, source = result.model_dump(), "ki"

    report = _get_or_create(session, project.id, date)
    report.work_completed = _append(report.work_completed, data["work_completed"])
    report.deviations_incidents = _append(report.deviations_incidents, data["deviations_incidents"])
    report.deliveries = _append(report.deliveries, data["deliveries"])
    if data["weather"].strip() and not weather_text(report.weather):
        report.weather = json.dumps({"condition": data["weather"].strip()}, ensure_ascii=False)
    digits = re.sub(r"\D", "", data["workforce_count"])
    if digits:
        report.workforce_count = int(digits)
    if data["trades"]:
        current = _json(report.trades) or []
        merged = current + [t.strip() for t in data["trades"] if t.strip() and t.strip() not in current]
        report.trades = json.dumps(merged, ensure_ascii=False)
    report.updated_at = dt.datetime.now(dt.timezone.utc)
    session.add(report)

    # Nur bekannte Vorgänge und 0–100 % – alles andere verwirft der Code (KI-Fehler/Erfindungen).
    for p in data["progress"]:
        task = by_code.get(str(p["task_code"]).strip().lower())
        if task is not None and 0 <= int(p["percent"]) <= 100:
            _set_progress(session, report, task.id, int(p["percent"]), source)

    # Contract: /fill liefert auch neue Tagebuch-Events → Diktat als SiteNote ablegen.
    category = "delay" if data["deviations_incidents"].strip() else "progress"
    note = SiteNote(project_id=project.id, content=req.text.strip(), category=category, status="incorporated")
    session.add(note)
    session.commit()
    session.refresh(report)
    session.refresh(note)

    out = to_out(session, project.id, date, report)
    return FillResponse(**out.model_dump(), mode=mode, site_note_id=note.id)

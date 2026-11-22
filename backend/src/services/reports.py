"""Tagesberichte: lesen, speichern, per Diktat ergänzen (/fill) – inkl. Fortschritt je Vorgang.

Mapping Formular ↔ Datenbank:
- weather + temperature_c ↔ DailyReport.weather als JSON {"condition": text, "temp_c": zahl}
- attendance (Liste)  ↔ DailyReport.workforce als JSON-Liste [{company, trade, workers, hours}]
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
from src.schemas.reports import (
    AttendanceItem,
    BulletRemoveRequest,
    CategorizedBullets,
    FillRequest,
    FillResponse,
    ProgressOut,
    ReportIn,
    ReportOut,
)
from src.services import llm, offline_rules
from src.services.workforce import attendance_of, contracts_with_target, match_contract, store_attendance, tokens

# Schlüsselwörter für Vorkommnisse (Behinderung, Mehrkosten, Mangel) aus den Offline-Regeln.
_INCIDENT_WORDS = [w for t in ("delay", "cost", "defect") for w in offline_rules.KEYWORDS[t]]
_DELIVERY_WORDS = ("liefer", "angeliefert", "lieferschein", "abnahme", "prüfstatiker", "betonprüfer", "begehung",
                   "dostaw")
_CATEGORY_PREFIX_RE = re.compile(
    r"^(baufortschritt|fortschritt|gewerk(?:e)?|firma|firmen|behinderung(?:en)?|störung(?:en)?|mehrkosten|nachtrag|nachträge|mangel|mängel|lieferung(?:en)?|material)\s*:\s*(.+)$",
    re.IGNORECASE,
)
_PERCENT_RE = re.compile(r"(\d{1,3})\s*(?:%|prozent|procent)", re.IGNORECASE)
# Anwesenheit im Diktat, DE + PL: "Fa. Krause nur 3 Mann", "3 Leute von Krause", "firma Krause tylko 3 osoby".
_CREW_WORDS = r"(?:Mann|Leute|Leuten|Arbeiter|Arbeitern|Arbeitskräfte|Personen|Monteure|osób|osoby|ludzi|pracowników|robotników)"
_NAME = r"([A-ZÄÖÜŁŚŻŹĆ][\wäöüßąćęłńóśźż\-]+)"
_CREW_RES = [
    re.compile(rf"(?:Fa\.|Firma|firma|firmy)\s*{_NAME}\D{{0,25}}?(\d{{1,3}})\s*{_CREW_WORDS}"),
    re.compile(rf"(\d{{1,3}})\s*{_CREW_WORDS}\s+(?:von|vom|der|z|od)?\s*(?:Fa\.|Firma|firmy)?\s*{_NAME}"),
    re.compile(rf"{_NAME}\s+(?:mit|nur|hat|ma|tylko)\s+(?:nur\s+|tylko\s+)?(\d{{1,3}})\s*{_CREW_WORDS}"),
]


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


def weather_parts(value: str | None) -> tuple[str | None, float | None]:
    """Wetter aus DB getrennt: (Beschreibung, Temperatur °C) – für das Formular."""
    data = _json(value)
    if isinstance(data, dict):
        return (str(data["condition"]) if data.get("condition") else None), data.get("temp_c")
    return value or None, None


def _store_weather(report: DailyReport, condition: str | None, temp: float | None) -> None:
    data = {k: v for k, v in (("condition", condition), ("temp_c", temp)) if v not in (None, "")}
    old = _json(report.weather)
    if isinstance(old, dict) and old.get("rain_mm") is not None and data:
        data["rain_mm"] = old["rain_mm"]  # Niederschlag aus Seed/Import nicht verlieren
    report.weather = json.dumps(data, ensure_ascii=False) if data else None


def _workforce_count(report: DailyReport) -> int | None:
    """Personal gesamt: eigene Spalte, sonst Summe aus dem workforce-JSON (Seed/Altdaten)."""
    if report.workforce_count is not None:
        return report.workforce_count
    crews = _json(report.workforce)
    if isinstance(crews, list):
        return sum(int(c.get("workers") or 0) for c in crews if isinstance(c, dict)) or None
    return None


def _bullets_of(report: DailyReport | None) -> CategorizedBullets:
    """Liest die gespeicherten kategorisierten Stichpunkte aus DailyReport.bullets_json."""
    if report is None:
        return CategorizedBullets()
    raw = _json(report.bullets_json)
    if not isinstance(raw, dict):
        return CategorizedBullets()
    return CategorizedBullets(
        progress=_clean_bullets(raw.get("progress") or []),
        trades=_clean_bullets(raw.get("trades") or []),
        hindrance=_clean_bullets(raw.get("hindrance") or []),
        cost=_clean_bullets(raw.get("cost") or []),
        defect=_clean_bullets(raw.get("defect") or []),
        delivery=_clean_bullets(raw.get("delivery") or []),
    )


def _store_bullets(report: DailyReport, cats: CategorizedBullets) -> None:
    cleaned = CategorizedBullets(
        progress=_clean_bullets(cats.progress),
        trades=_clean_bullets(cats.trades),
        hindrance=_clean_bullets(cats.hindrance),
        cost=_clean_bullets(cats.cost),
        defect=_clean_bullets(cats.defect),
        delivery=_clean_bullets(cats.delivery),
    )
    report.bullets_json = json.dumps(cleaned.model_dump(), ensure_ascii=False) if cleaned.has_any() else None


def _merge_bullets(existing: CategorizedBullets, incoming: CategorizedBullets) -> CategorizedBullets:
    return CategorizedBullets(
        progress=_clean_bullets(existing.progress + incoming.progress),
        trades=_clean_bullets(existing.trades + incoming.trades),
        hindrance=_clean_bullets(existing.hindrance + incoming.hindrance),
        cost=_clean_bullets(existing.cost + incoming.cost),
        defect=_clean_bullets(existing.defect + incoming.defect),
        delivery=_clean_bullets(existing.delivery + incoming.delivery),
    )


def _bullet_candidates(category: str, item: str) -> list[str]:
    clean = (item or "").strip()
    if not clean:
        return []
    if category == "hindrance":
        return [_format_bullet("Behinderung", clean), clean]
    if category == "cost":
        return [_format_bullet("Mehrkosten", clean), clean]
    if category == "defect":
        return [_format_bullet("Mangel", clean), clean]
    return [clean]


def _norm_match(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lstrip("-•* ").rstrip(".")).lower()


def _remove_lines(old: str | None, candidates: list[str]) -> str | None:
    """Entfernt Zeilen (oder Teil-Einträge) aus einem Berichtsfeld, die einem der Kandidaten entsprechen."""
    if not old:
        return old
    raw_targets = [c.strip() for c in candidates if c.strip()]
    if not raw_targets:
        return old
    norm_targets = {_norm_match(c) for c in raw_targets}
    kept: list[str] = []
    for line in old.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if _norm_match(stripped) in norm_targets:
            continue
        updated = stripped
        for cand in sorted(raw_targets, key=len, reverse=True):
            # Falls mehrere Sätze auf derselben Zeile standen, den passenden Abschnitt sauber entfernen.
            pattern = re.compile(r"(?:^|\s*;\s*|\s+)" + re.escape(cand) + r"\.?(?=\s|$|;)", re.IGNORECASE)
            updated = pattern.sub(" ", updated).strip(" ;")
        updated = re.sub(r"\s{2,}", " ", updated).strip()
        if updated:
            kept.append(updated)
    joined = "\n".join(kept).strip()
    return joined or None


def _sync_bullets_with_fields(report: DailyReport) -> None:
    """Hält bullets_json synchron, falls Stichpunkte direkt im Tagesbericht bearbeitet/gelöscht wurden."""
    stored = _bullets_of(report)
    if not stored.has_any():
        return
    field_map = {
        "progress": report.work_completed or "",
        "hindrance": report.deviations_incidents or "",
        "cost": report.deviations_incidents or "",
        "defect": report.deviations_incidents or "",
        "delivery": report.deliveries or "",
    }
    kept = CategorizedBullets()
    for cat_name, field_text in field_map.items():
        items = getattr(stored, cat_name)
        norm_field = _norm_match(field_text)
        still_there = [
            item for item in items
            if any(
                cand in field_text or (_norm_match(cand) and _norm_match(cand) in norm_field)
                for cand in _bullet_candidates(cat_name, item)
            )
        ]
        setattr(kept, cat_name, still_there)
    current_trades = _json(report.trades) or []
    norm_trades = {_norm_match(t) for t in current_trades if isinstance(t, str)}
    kept.trades = [item for item in stored.trades if _norm_match(item) in norm_trades]
    _store_bullets(report, kept)


def to_out(session: Session, project_id: int, date: dt.date, report: DailyReport | None) -> ReportOut:
    """DB-Bericht (oder None = noch nicht gespeichert) → API-Form."""
    if report is None:
        return ReportOut(id=None, project_id=project_id, report_date=date, report_number=None, weather=None,
                         temperature_c=None, site_manager=None,
                         workforce_count=None, trades=[], work_completed=None, deviations_incidents=None,
                         deliveries=None, summary=None, status="draft", progress=[], categories=CategorizedBullets())
    trades = _json(report.trades)
    rows = session.exec(
        select(ReportProgress, PlanTask).join(PlanTask, ReportProgress.task_id == PlanTask.id)
        .where(ReportProgress.report_id == report.id).order_by(PlanTask.planned_start, PlanTask.id)
    ).all()
    condition, temp = weather_parts(report.weather)
    return ReportOut(
        id=report.id, project_id=report.project_id, report_date=report.report_date,
        report_number=report.report_number, weather=condition, temperature_c=temp,
        site_manager=report.site_manager, attendance=attendance_of(report),
        workforce_count=_workforce_count(report), trades=trades if isinstance(trades, list) else [],
        work_completed=report.work_completed, deviations_incidents=report.deviations_incidents,
        deliveries=report.deliveries, summary=report.summary, status=report.status,
        progress=[ProgressOut(task_id=t.id, task_code=t.task_code, title=t.title, percent=p.percent,
                              source=p.source, note=p.note) for p, t in rows],
        categories=_bullets_of(report),
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
    _store_weather(report, data.weather, data.temperature_c)
    report.site_manager = data.site_manager
    if data.attendance is not None:
        store_attendance(report, data.attendance)
    report.workforce_count = data.workforce_count
    if report.workforce_count is None and data.attendance:
        report.workforce_count = sum(a.workers for a in data.attendance)
    report.trades = json.dumps(data.trades, ensure_ascii=False) if data.trades else None
    report.work_completed = data.work_completed
    report.deviations_incidents = data.deviations_incidents
    report.deliveries = data.deliveries
    report.summary = data.summary
    report.status = data.status
    _sync_bullets_with_fields(report)
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


class _LLMAttendance(BaseModel):
    company: str
    trade: str
    workers: int


class _LLMFill(BaseModel):
    work_completed: str
    deviations_incidents: str
    deliveries: str
    weather: str
    temperature_c: str
    workforce_count: str
    trades: list[str]
    attendance: list[_LLMAttendance]
    progress: list[_LLMProgress]


FILL_PROMPT = """Du füllst den Bautagesbericht eines deutschen Bauleiters aus einem Diktat.
Das Diktat kann in jeder Sprache sein (z. B. Polnisch) – schreibe ALLE Werte auf Deutsch.

Felder (unbekannt = leerer String bzw. leere Liste, NIE etwas erfinden):
- work_completed: ausgeführte Arbeiten / Tagesleistung als ganze Sätze, inkl. Fortschrittsangaben
  (z. B. "Aushub Achse B zu 80 % fertiggestellt."). Gewerke/Firmen gehören NICHT hierher, sondern in trades.
- deviations_incidents: Behinderungen, Stillstand, Verzug, Mängel, Unfälle, Mehrkosten.
- deliveries: Lieferungen, Abnahmen, Prüfungen.
- weather: Wetter (ohne Temperatur), nur wenn genannt.
- temperature_c: Temperatur in °C als Zahl (z. B. "6"), nur wenn genannt.
- workforce_count: Anzahl Personen auf der Baustelle GESAMT als Ziffern, nur wenn genannt.
- attendance: Anwesenheit je Firma/Gewerk, nur wenn eine Anzahl genannt ist
  (z. B. "Fa. Krause nur 3 Mann" → {"company": "Krause", "trade": "", "workers": 3}).
  Firmen möglichst wie in der Firmenliste schreiben.
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


def _offline_attendance(text: str) -> list[dict]:
    """Regeln ohne KI: "Fa. X nur 3 Mann" / "3 Leute von X" / "firma X tylko 3 osoby"."""
    found: dict[str, dict] = {}
    for i, rx in enumerate(_CREW_RES):
        for m in rx.finditer(text):
            name, number = (m.group(2), m.group(1)) if i == 1 else (m.group(1), m.group(2))
            found.setdefault(name.lower(), {"company": name, "trade": "", "workers": int(number)})
    return list(found.values())


def _offline_progress(sentences: list[str], tasks: list[PlanTask]) -> list[dict]:
    progress = []
    for s in sentences:
        m = _PERCENT_RE.search(s)
        if not m:
            continue
        lower = s.lower()
        for t in tasks:
            if t.title.lower() in lower or (t.task_code and t.task_code.lower() in lower):
                progress.append({"task_code": _code(t), "percent": int(m.group(1))})
    return progress


def _offline_fill(text: str, tasks: list[PlanTask]) -> dict:
    """Regeln ohne KI: Präfixe & Schlüsselwörter → Leistung / Vorkommnisse / Lieferungen, "Titel … NN %" → Fortschritt."""
    work: list[str] = []
    trades: list[str] = []
    incidents: list[str] = []
    deliveries: list[str] = []
    all_sentences: list[str] = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        pref = _CATEGORY_PREFIX_RE.match(line)
        if pref:
            head = pref.group(1).lower()
            body = pref.group(2).strip()
            parts = [p.strip() for p in re.split(r";\s*", body) if p.strip()]
            all_sentences.extend(parts)
            if head.startswith(("baufortschritt", "fortschritt")):
                work.extend(parts)
            elif head.startswith(("gewerk", "firma", "firmen")):
                trades.extend(parts)
            elif head.startswith(("liefer", "material")):
                deliveries.extend(parts)
            elif head.startswith(("mehrkosten", "nachtrag", "nachträge")):
                incidents.extend(_format_bullet("Mehrkosten", p) for p in parts)
            elif head.startswith(("mangel", "mängel")):
                incidents.extend(_format_bullet("Mangel", p) for p in parts)
            else:
                incidents.extend(_format_bullet("Behinderung", p) for p in parts)
            continue

        line_sentences = [s.strip() for s in re.split(r"(?<=[.!?;])\s+", line) if s.strip()]
        all_sentences.extend(line_sentences)
        for s in line_sentences:
            lower = s.lower()
            if any(w in lower for w in _INCIDENT_WORDS):
                incidents.append(s)
            elif any(w in lower for w in _DELIVERY_WORDS):
                deliveries.append(s)
            else:
                work.append(s)

    return {
        "work_completed": " ".join(work),
        "deviations_incidents": " ".join(incidents),
        "deliveries": " ".join(deliveries),
        "weather": "",
        "temperature_c": "",
        "workforce_count": "",
        "trades": _clean_bullets(trades),
        "attendance": _offline_attendance(text),
        "progress": _offline_progress(all_sentences, tasks),
    }


def _clean_bullets(items: list[str]) -> list[str]:
    seen: set[str] = set()
    cleaned: list[str] = []
    for raw in items:
        val = (raw or "").strip()
        if val and val not in seen:
            seen.add(val)
            cleaned.append(val)
    return cleaned


def _format_bullet(label: str, item: str) -> str:
    if re.match(rf"^{re.escape(label)}\b", item, re.IGNORECASE):
        return item
    if label == "Mehrkosten" and re.match(r"^nachtrag\b", item, re.IGNORECASE):
        return item
    if label == "Mangel" and re.match(r"^mängel\b", item, re.IGNORECASE):
        return item
    return f"{label}: {item}"


def _categories_to_note_lines(cats: CategorizedBullets | None) -> list[str]:
    if cats is None:
        return []
    groups = [
        ("Baufortschritt", _clean_bullets(cats.progress)),
        ("Gewerke", _clean_bullets(cats.trades)),
        ("Behinderungen", _clean_bullets(cats.hindrance)),
        ("Mehrkosten", _clean_bullets(cats.cost)),
        ("Mängel", _clean_bullets(cats.defect)),
        ("Lieferungen", _clean_bullets(cats.delivery)),
    ]
    return [f"{label}: {'; '.join(items)}" for label, items in groups if items]


def _merge_attendance(report: DailyReport, new: list[dict], contracts) -> None:
    """Diktierte Anwesenheit einpflegen: bekannte Firma → Vertragsname/Gewerk, gleiche Firma wird ersetzt."""
    items = attendance_of(report)
    for row in new:
        try:
            workers = int(row.get("workers"))
        except (TypeError, ValueError):
            continue
        if not 0 <= workers <= 500:
            continue  # Unsinn verwerfen (KI-Fehler)
        item = AttendanceItem(company=(row.get("company") or "").strip() or None,
                              trade=(row.get("trade") or "").strip() or None, workers=workers)
        if item.company is None and item.trade is None:
            continue
        contract = match_contract(item, contracts)
        if contract is not None:  # Schreibweise aus dem Vertrag übernehmen → spätere Zuordnung eindeutig
            item = AttendanceItem(company=contract.contractor_name or item.company,
                                  trade=contract.trade or item.trade, workers=workers)
        key = tokens(item.company) or {(item.trade or "").lower()}
        items = [i for i in items if not (key & (tokens(i.company) or {(i.trade or "").lower()}))]
        items.append(item)
    if new:
        store_attendance(report, items)


async def fill(session: Session, project: Project, date: dt.date, req: FillRequest) -> FillResponse:
    """Diktat/Stichpunkte → Bericht des Tages ergänzen (+ Tagebucheintrag). Status bleibt 'draft'."""
    tasks = project_tasks(session, project.id)
    by_code = {_code(t).lower(): t for t in tasks}

    contracts = contracts_with_target(session, project.id)
    clean_text = req.text.strip()
    mode: Literal["ai", "offline"] = "offline"
    source = "regel"
    if clean_text:
        firms = "\n".join(f"- {c.contractor_name or '?'} ({c.trade or '?'})" for c in contracts) or "(keine)"
        user = (f"Vorgangsliste des Projektplans:\n{_task_list(tasks)}\n\nFirmenliste:\n{firms}\n\n"
                f"Diktat ({req.lang}):\n{clean_text}")
        result = await llm.complete_json(FILL_PROMPT, user, _LLMFill, max_tokens=1200)
        if result is None:
            data, mode, source = _offline_fill(clean_text, tasks), "offline", "regel"
        else:
            data, mode, source = result.model_dump(), "ai", "ki"
    else:
        data = {
            "work_completed": "",
            "deviations_incidents": "",
            "deliveries": "",
            "weather": "",
            "temperature_c": "",
            "workforce_count": "",
            "trades": [],
            "attendance": [],
            "progress": [],
        }

    report = _get_or_create(session, project.id, date)
    report.work_completed = _append(report.work_completed, data["work_completed"])
    report.deviations_incidents = _append(report.deviations_incidents, data["deviations_incidents"])
    report.deliveries = _append(report.deliveries, data["deliveries"])

    cat_has_incident = False
    if req.categories is not None:
        cat_progress = _clean_bullets(req.categories.progress)
        cat_trades = _clean_bullets(req.categories.trades)
        cat_hindrance = _clean_bullets(req.categories.hindrance)
        cat_cost = _clean_bullets(req.categories.cost)
        cat_defect = _clean_bullets(req.categories.defect)
        cat_delivery = _clean_bullets(req.categories.delivery)

        for item in cat_progress:
            report.work_completed = _append(report.work_completed, item)
        if cat_trades:
            data["trades"] = list(data["trades"]) + cat_trades
        for item in cat_hindrance:
            report.deviations_incidents = _append(report.deviations_incidents, _format_bullet("Behinderung", item))
        for item in cat_cost:
            report.deviations_incidents = _append(report.deviations_incidents, _format_bullet("Mehrkosten", item))
        for item in cat_defect:
            report.deviations_incidents = _append(report.deviations_incidents, _format_bullet("Mangel", item))
        for item in cat_delivery:
            report.deliveries = _append(report.deliveries, item)

        incoming_cats = CategorizedBullets(
            progress=cat_progress,
            trades=cat_trades,
            hindrance=cat_hindrance,
            cost=cat_cost,
            defect=cat_defect,
            delivery=cat_delivery,
        )
        _store_bullets(report, _merge_bullets(_bullets_of(report), incoming_cats))

        cat_has_incident = bool(cat_hindrance or cat_cost or cat_defect)
        all_bullets = cat_progress + cat_trades + cat_hindrance + cat_cost + cat_defect + cat_delivery
        if all_bullets:
            joined_bullets = "\n".join(all_bullets)
            bullet_attendance = _offline_attendance(joined_bullets)
            if bullet_attendance:
                data["attendance"] = list(data["attendance"]) + bullet_attendance
            bullet_progress = _offline_progress(all_bullets, tasks)
            if bullet_progress:
                data["progress"] = list(data["progress"]) + bullet_progress
    condition, temp = weather_parts(report.weather)
    temp_digits = re.sub(r"[^\d.,-]", "", data["temperature_c"]).replace(",", ".")
    new_temp = float(temp_digits) if re.fullmatch(r"-?\d{1,2}(\.\d)?", temp_digits) else None
    if (data["weather"].strip() and not condition) or (new_temp is not None and temp is None):
        _store_weather(report, condition or data["weather"].strip() or None, temp if temp is not None else new_temp)
    _merge_attendance(report, data["attendance"], contracts)
    digits = re.sub(r"\D", "", data["workforce_count"])
    if digits:
        report.workforce_count = int(digits)
    elif report.workforce_count is None and attendance_of(report):
        report.workforce_count = sum(a.workers for a in attendance_of(report))
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

    # Contract: /fill liefert auch neue Tagebuch-Events → Diktat/Stichpunkte als SiteNote ablegen.
    note_parts = [clean_text] if clean_text else []
    note_parts.extend(_categories_to_note_lines(req.categories))
    note_content = "\n".join(note_parts)
    category = "delay" if (data["deviations_incidents"].strip() or cat_has_incident) else "progress"
    note = SiteNote(project_id=project.id, content=note_content, category=category, status="incorporated")
    session.add(note)
    session.commit()
    session.refresh(report)
    session.refresh(note)

    out = to_out(session, project.id, date, report)
    return FillResponse(**out.model_dump(), mode=mode, site_note_id=note.id)


def remove_bullet(session: Session, project: Project, date: dt.date, req: BulletRemoveRequest) -> ReportOut:
    """Entfernt einen kategorisierten Stichpunkt aus bullets_json UND dem passenden Berichtsfeld."""
    report = find_report(session, project.id, date)
    if report is None:
        return to_out(session, project.id, date, None)

    clean = req.text.strip()
    norm_clean = _norm_match(clean)
    stored = _bullets_of(report)
    categories_to_clean: list[str] = [req.category]
    for cat_name in ("progress", "trades", "hindrance", "cost", "defect", "delivery"):
        items = getattr(stored, cat_name)
        filtered = [item for item in items if _norm_match(item) != norm_clean]
        if len(filtered) != len(items):
            setattr(stored, cat_name, filtered)
            if cat_name not in categories_to_clean:
                categories_to_clean.append(cat_name)
    _store_bullets(report, stored)

    for cat_name in categories_to_clean:
        candidates = _bullet_candidates(cat_name, clean)
        if cat_name == "progress":
            report.work_completed = _remove_lines(report.work_completed, candidates)
        elif cat_name == "trades":
            current_trades = _json(report.trades) or []
            kept_trades = [t for t in current_trades if isinstance(t, str) and _norm_match(t) != norm_clean]
            report.trades = json.dumps(kept_trades, ensure_ascii=False) if kept_trades else None
        elif cat_name in ("hindrance", "cost", "defect"):
            report.deviations_incidents = _remove_lines(report.deviations_incidents, candidates)
        elif cat_name == "delivery":
            report.deliveries = _remove_lines(report.deliveries, candidates)

    report.updated_at = dt.datetime.now(dt.timezone.utc)
    session.add(report)
    session.commit()
    session.refresh(report)
    return to_out(session, project.id, date, report)

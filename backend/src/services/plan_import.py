"""Terminplan-Import (Board: "Terminplan Import/Datenmodell"): CSV direkt, PDF per KI als Vorschau.

CSV: Export aus Excel / MS Project. Trennzeichen (; , Tab) und Spalten werden erkannt
(deutsche und englische Namen), Datumsformate TT.MM.JJJJ, TT.MM.JJ, ISO, "Mo 16.11.26".
PDF: Text per pypdf, KI liest Vorgänge mit wörtlichem Zitat. Der Code prüft Zitat + Datum –
was nicht belegt ist, wird verworfen (unbekannt = leer). PDF-Ergebnisse sind immer nur Vorschau.

Übernehmen (`apply`): Upsert per Code (sonst Titel). Es wird nie etwas gelöscht, weil gemeldeter
Fortschritt (ReportProgress) an den Vorgängen hängt – sonst wäre die Soll/Ist-Historie weg.
"""

import csv
import datetime as dt
import io
import re
from typing import Literal

from pydantic import BaseModel
from sqlmodel import Session, select

from src.models import ConstructionPlan, PlanTask
from src.schemas.plan_tasks import ImportedTask, RowError
from src.services import llm

MAX_PDF_CHARS = 12_000

# Spaltenname (klein, ohne Sonderzeichen) → Feld
COLUMNS = {
    "code": ("nr", "code", "vorgangsnr", "vorgangsnummer", "id", "psp", "pspcode", "wbs", "pos", "position"),
    "title": ("vorgang", "vorgangsname", "name", "bezeichnung", "leistung", "task", "taskname", "beschreibung"),
    "trade": ("gewerk", "trade", "firma", "ressource", "ressourcen", "resourcenames", "verantwortlich"),
    "start": ("anfang", "beginn", "start", "startdatum", "von", "planstart", "sollbeginn"),
    "end": ("ende", "fertig", "fertigstellung", "finish", "enddatum", "bis", "planende", "sollende"),
}
_DATE_RE = re.compile(r"(\d{1,2})\.(\d{1,2})\.(\d{2,4})")


def _key(name: str) -> str:
    return re.sub(r"[^a-zäöüß]", "", name.strip().lower())


def parse_date(value: str) -> dt.date | None:
    """'16.11.2026', '16.11.26', 'Mo 16.11.26', '2026-11-16' → Datum; sonst None."""
    value = (value or "").strip()
    if not value:
        return None
    try:
        return dt.date.fromisoformat(value[:10])
    except ValueError:
        pass
    m = _DATE_RE.search(value)
    if not m:
        return None
    day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    year += 2000 if year < 100 else 0
    try:
        return dt.date(year, month, day)
    except ValueError:
        return None


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


class _Semicolon(csv.excel):
    delimiter = ";"


class NoColumns(ValueError):
    """CSV ohne erkennbare Spalten Vorgang/Anfang/Ende → 422."""


def parse_csv(data: bytes) -> tuple[list[ImportedTask], list[RowError]]:
    text = _decode(data).strip()
    if not text:
        raise NoColumns("Datei ist leer")
    try:
        dialect = csv.Sniffer().sniff(text.splitlines()[0], delimiters=";,\t")
    except csv.Error:
        dialect = _Semicolon  # deutsche Excel-Exporte nutzen meist ";"
    rows = list(csv.reader(io.StringIO(text), dialect))
    header = [_key(h) for h in rows[0]]
    index = {}
    for field, names in COLUMNS.items():
        for i, h in enumerate(header):
            if h in names and field not in index:
                index[field] = i
    missing = [f for f in ("title", "start", "end") if f not in index]
    if missing:
        raise NoColumns(f"Spalten nicht erkannt: {', '.join(missing)} (gefunden: {', '.join(rows[0])})")

    tasks, errors = [], []
    for n, row in enumerate(rows[1:], start=2):  # Zeile 1 = Kopf
        if not any(c.strip() for c in row):
            continue
        cell = lambda f: row[index[f]].strip() if f in index and index[f] < len(row) else ""  # noqa: E731
        title, start, end = cell("title"), parse_date(cell("start")), parse_date(cell("end"))
        if not title:
            errors.append(RowError(row=n, error="Vorgang ohne Bezeichnung"))
        elif start is None or end is None:
            errors.append(RowError(row=n, error=f"Datum unlesbar: '{cell('start')}' / '{cell('end')}'"))
        elif end < start:
            errors.append(RowError(row=n, error=f"Ende {end:%d.%m.%Y} liegt vor Anfang {start:%d.%m.%Y}"))
        else:
            tasks.append(ImportedTask(code=cell("code") or None, title=title, trade=cell("trade") or None,
                                      start=start, end=end, source=f"CSV Zeile {n}"))
    return tasks, errors


# ---------------------------------------------------------------- PDF

class _LLMTask(BaseModel):
    code: str
    title: str
    trade: str
    start: str
    end: str
    quote: str


class _LLMPlan(BaseModel):
    tasks: list[_LLMTask]


PDF_PROMPT = """Du liest den Text eines deutschen Bauzeitenplans (Terminplan, Gantt-Export).
Liste jeden Vorgang mit: code (Vorgangsnummer, sonst leer), title, trade (Gewerk, sonst leer),
start und end als TT.MM.JJJJ und quote = die Zeile genau so, wie sie im Text steht.
NIE Vorgänge oder Termine erfinden. Sammelvorgänge/Überschriften ohne eigene Termine weglassen."""

_PDF_LINE_RE = re.compile(
    r"^\s*(?:(?P<code>[A-Z]{0,3}-?\d{1,4}(?:\.\d+)*)\s+)?(?P<title>[A-Za-zÄÖÜäöüß][^\n]*?)\s+"
    r"(?:\w{2}\s+)?(?P<start>\d{1,2}\.\d{1,2}\.\d{2,4})\s*(?:-|–|bis|\s)\s*(?:\w{2}\s+)?(?P<end>\d{1,2}\.\d{1,2}\.\d{2,4})",
    re.MULTILINE)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def _offline_pdf(text: str) -> list[ImportedTask]:
    tasks = []
    for m in _PDF_LINE_RE.finditer(text):
        start, end = parse_date(m.group("start")), parse_date(m.group("end"))
        if start and end and end >= start:
            tasks.append(ImportedTask(code=m.group("code"), title=m.group("title").strip(" .:-"), trade=None,
                                      start=start, end=end, source=f"PDF: „{m.group(0).strip()[:160]}“"))
    return tasks


async def parse_pdf_text(text: str) -> tuple[list[ImportedTask], list[str], Literal["ai", "offline"]]:
    """PDF-Text → Vorgänge (Vorschau). Rückgabe: Vorgänge, Warnungen, Modus."""
    result = await llm.complete_json(PDF_PROMPT, text[:MAX_PDF_CHARS], _LLMPlan, max_tokens=2500)
    if result is None:
        return _offline_pdf(text), [], "offline"
    text_norm, tasks, warnings = _norm(text), [], []
    for t in result.tasks:
        start, end = parse_date(t.start), parse_date(t.end)
        if not t.quote.strip() or _norm(t.quote) not in text_norm:
            warnings.append(f"Verworfen (nicht im Plan belegt): {t.title}")
        elif start is None or end is None or end < start:
            warnings.append(f"Verworfen (Datum ungültig): {t.title} {t.start}–{t.end}")
        else:
            tasks.append(ImportedTask(code=t.code.strip() or None, title=t.title.strip(), trade=t.trade.strip() or None,
                                      start=start, end=end, source=f"PDF: „{t.quote.strip()[:160]}“"))
    if len(text) > MAX_PDF_CHARS:
        warnings.append(f"Plan gekürzt auf die ersten {MAX_PDF_CHARS} Zeichen – bitte Vollständigkeit prüfen.")
    return tasks, warnings, "ai"


# ---------------------------------------------------------------- übernehmen

def apply(session: Session, plan: ConstructionPlan, tasks: list[ImportedTask]) -> tuple[int, int]:
    """Upsert per Code (sonst Titel) – nichts wird gelöscht. Rückgabe: (neu, aktualisiert). Ohne Commit."""
    existing = list(session.exec(select(PlanTask).where(PlanTask.plan_id == plan.id)).all())
    by_code = {t.task_code.strip().lower(): t for t in existing if t.task_code}
    by_title = {t.title.strip().lower(): t for t in existing}
    created = updated = 0
    for item in tasks:
        task = (by_code.get(item.code.strip().lower()) if item.code else None) or by_title.get(item.title.strip().lower())
        if task is None:
            task = PlanTask(plan_id=plan.id, task_code=item.code, title=item.title, status="pending")
            created += 1
            by_title[item.title.strip().lower()] = task
            if item.code:
                by_code[item.code.strip().lower()] = task
        else:
            updated += 1
        task.title, task.trade = item.title, item.trade or task.trade
        task.task_code = item.code or task.task_code
        task.planned_start, task.planned_end = item.start, item.end
        session.add(task)
    return created, updated

"""Zusammenfassungen auf Anfrage (Kern von POST /api/summarize).

Zeitraum-Modus: sammelt Tagesberichte, Tagebuchnotizen und Briefe einer Woche/eines Monats.
Text-Modus:     fasst einen freien Text zusammen (E-Mail, Protokoll).

Aufgabenteilung (CLAUDE.md: Zahlen und Rechtliches in testbarem Code):
- Code:  Zeitraum, Datensammlung, Kennzahlen, Quellen-Labels, Empfehlungstexte je Brieftyp,
         Prüfung, dass jede Quelle wirklich existiert (Traceability).
- LLM:   Kernaussagen formulieren, Entscheidungen/offene Punkte/Risiken erkennen und
         der passenden Quelle zuordnen.
Fällt das LLM aus (kein Key, Timeout, 429), liefert ein Regel-Fallback dieselbe Form.
"""

import calendar
import datetime as dt
import json
import re
from typing import Literal

from pydantic import BaseModel
from sqlmodel import Session, select

from src.models import DailyReport, FormalNotice, Project, SiteNote
from src.schemas.summary import ActionItem, LinkType, SummaryResponse, SummaryStats, VobRisk
from src.services import llm, offline_rules
from src.services.letters import TYPE_NAMES

# ~12.000 Zeichen ≈ 3.500 Tokens: bleibt mit Antwort unter Groqs 8.000 Tokens/Minute.
MAX_CONTEXT_CHARS = 12_000

MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
             "August", "September", "Oktober", "November", "Dezember"]

SOURCE_TYPE_LABELS = {"diary": "Tagebuch", "minutes": "Protokoll", "emails": "E-Mail"}

# Empfehlungstexte stehen bewusst in Code (kein LLM-Wortlaut zu Rechtlichem).
# Sie sagen nur, WELCHES Schreiben zu prüfen ist – keine Rechtsberatung.
RECOMMENDATIONS: dict[LinkType | None, str] = {
    "delay": "Prüfen, ob eine Behinderungsanzeige nach § 6 Abs. 1 VOB/B erforderlich ist.",
    "cost": "Prüfen, ob eine Mehrkostenanmeldung nach § 2 Abs. 5/6 VOB/B erforderlich ist.",
    "defect": "Prüfen, ob eine Mängelrüge nach § 4 Abs. 7 VOB/B erforderlich ist.",
    None: "Vorkommnis dokumentieren und Auswirkungen auf Termine und Kosten prüfen.",
}


# ---------------------------------------------------------------- Hilfsfunktionen

def _de(d: dt.date) -> str:
    return d.strftime("%d.%m.%Y")


def _json(value: str | None):
    """JSON-String fehlertolerant lesen: kaputtes oder leeres JSON → None statt Absturz."""
    if not value:
        return None
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        return None


def _detect_link(text: str) -> LinkType | None:
    """Brieftyp per Schlüsselwort (Offline-Regeln). Nur bei echtem Treffer, sonst None."""
    lower = text.lower()
    for notice_type, words in offline_rules.KEYWORDS.items():
        if any(w in lower for w in words):
            return notice_type if notice_type in ("delay", "cost", "defect") else None
    return None


def resolve_period(period: Literal["week", "month"], ref_date: dt.date) -> tuple[dt.date, dt.date]:
    """Zeitraum zu einem Stichtag: Woche = Montag–Sonntag, Monat = 1. bis letzter Tag."""
    if period == "week":
        start = ref_date - dt.timedelta(days=ref_date.weekday())
        return start, start + dt.timedelta(days=6)
    last_day = calendar.monthrange(ref_date.year, ref_date.month)[1]
    return ref_date.replace(day=1), ref_date.replace(day=last_day)


# ---------------------------------------------------------------- Daten & Kennzahlen

def collect(session: Session, project_id: int, start: dt.date, end: dt.date):
    """Alle Einträge des Projekts im Zeitraum: (Tagesberichte, Notizen, Briefe), chronologisch."""
    reports = session.exec(
        select(DailyReport)
        .where(DailyReport.project_id == project_id, DailyReport.report_date >= start, DailyReport.report_date <= end)
        .order_by(DailyReport.report_date)
    ).all()
    # Notizen/Briefe haben nur einen Zeitstempel → Tagesgrenzen [start 00:00, end+1 00:00) in UTC
    # (die Modelle speichern UTC und verlangen Zeitstempel mit Zeitzone).
    t0 = dt.datetime.combine(start, dt.time.min, tzinfo=dt.timezone.utc)
    t1 = dt.datetime.combine(end + dt.timedelta(days=1), dt.time.min, tzinfo=dt.timezone.utc)
    notes = session.exec(
        select(SiteNote)
        .where(SiteNote.project_id == project_id, SiteNote.created_at >= t0, SiteNote.created_at < t1)
        .order_by(SiteNote.created_at)
    ).all()
    notices = session.exec(
        select(FormalNotice)
        .where(FormalNotice.project_id == project_id, FormalNotice.created_at >= t0, FormalNotice.created_at < t1)
        .order_by(FormalNotice.created_at)
    ).all()
    return reports, notes, notices


def compute_stats(reports: list[DailyReport], notices: list[FormalNotice]) -> SummaryStats:
    """Kennzahlen in Code (nicht vom LLM): Personenstunden, Ø Arbeitskräfte, Regen-/Vorkommnistage."""
    hours = 0.0
    workers_per_day: list[int] = []
    rain_days = 0
    for r in reports:
        crews = _json(r.workforce)
        if isinstance(crews, list):
            day_workers = 0
            for c in crews:
                if isinstance(c, dict):
                    day_workers += int(c.get("workers") or 0)
                    hours += float(c.get("hours") or 0)
            workers_per_day.append(r.workforce_count if r.workforce_count is not None else day_workers)
        elif r.workforce_count is not None:  # Bericht aus dem Formular (nur Personalanzahl, kein JSON)
            workers_per_day.append(r.workforce_count)
        weather = _json(r.weather)
        if isinstance(weather, dict):
            rain = float(weather.get("rain_mm") or 0)
            if rain > 0 or "regen" in str(weather.get("condition", "")).lower():
                rain_days += 1
    by_status: dict[str, int] = {}
    for n in notices:
        by_status[n.status] = by_status.get(n.status, 0) + 1
    return SummaryStats(
        reportDays=len(reports),
        workforceHours=round(hours, 1),
        avgWorkers=round(sum(workers_per_day) / len(workers_per_day), 1) if workers_per_day else 0.0,
        rainDays=rain_days,
        incidentDays=sum(1 for r in reports if (r.deviations_incidents or "").strip()),
        noticesByStatus=by_status,
    )


def _stats_sentence(s: SummaryStats) -> str:
    avg = f"{s.avgWorkers:.1f}".replace(".", ",")
    hours = f"{s.workforceHours:.0f}"
    return (
        f"{s.reportDays} Berichtstage, {hours} Personenstunden, Ø {avg} Arbeitskräfte/Tag, "
        f"{s.rainDays} Regentag(e), {s.incidentDays} Tag(e) mit Vorkommnissen."
    )


def report_label(r: DailyReport) -> str:
    return f"Tagesbericht {_de(r.report_date)}"


def note_label(n: SiteNote) -> str:
    return f"Notiz #{n.id} vom {_de(n.created_at.date())}"


def notice_label(n: FormalNotice) -> str:
    return f"Schreiben #{n.id} {TYPE_NAMES.get(n.type, n.type)}"


def build_blocks(reports, notes, notices) -> list[tuple[str, str]]:
    """Kompakte Textblöcke (Quellen-Label, Inhalt) als Kontext fürs LLM."""
    blocks: list[tuple[str, str]] = []
    for r in reports:
        parts = []
        weather = _json(r.weather)
        if isinstance(weather, dict) and weather.get("condition"):
            parts.append(f"Wetter: {weather.get('condition')}")
        for label, value in (("Zusammenfassung", r.summary), ("Ausgeführt", r.work_completed),
                             ("Vorkommnisse", r.deviations_incidents)):
            if value and value.strip():
                parts.append(f"{label}: {value.strip()}")
        blocks.append((report_label(r), " | ".join(parts)))
    for n in notes:
        blocks.append((note_label(n), n.content.strip()))
    for n in notices:
        blocks.append((notice_label(n), f"Status {n.status}. Betreff: {n.subject or n.title or ''}"))
    return blocks


def _fit(blocks: list[tuple[str, str]], limit: int = MAX_CONTEXT_CHARS) -> str:
    """Blöcke zu einem Kontext-Text; bei Überlänge jeden Block gleichmäßig kürzen (markiert)."""
    total = sum(len(t) + len(lbl) + 4 for lbl, t in blocks)
    per_block = limit // max(len(blocks), 1)
    lines = []
    for label, text in blocks:
        if total > limit and len(text) > per_block:
            text = text[: max(per_block - 12, 40)].rstrip() + " (gekürzt)"
        lines.append(f"[{label}] {text}")
    return "\n".join(lines)


# ---------------------------------------------------------------- LLM

class _LLMDecision(BaseModel):
    text: str
    source: str


class _LLMAction(BaseModel):
    task: str
    responsible: str
    deadline: str
    priority: Literal["Hoch", "Mittel", "Normal"]
    source: str


class _LLMRisk(BaseModel):
    title: str
    description: str
    linkType: Literal["delay", "cost", "defect", "none"]
    source: str


class _LLMSummary(BaseModel):
    executiveSummary: list[str]
    keyDecisions: list[_LLMDecision]
    actionItems: list[_LLMAction]
    vobRisks: list[_LLMRisk]


SYSTEM_PROMPT = """Du bist Assistent eines deutschen Bauleiters und fasst Baustellendokumentation zusammen.
Jeder Eintrag im Input beginnt mit seinem Quellen-Label in eckigen Klammern, z. B. [Tagesbericht 18.11.2026].

Liefere auf Deutsch, sachlich und knapp:
- executiveSummary: 2–5 Kernaussagen (je 1 Satz) zu Fortschritt, Störungen, Lage.
- keyDecisions: getroffene Festlegungen/Entscheidungen (nur wenn ausdrücklich genannt).
- actionItems: offene Punkte/Aufgaben. responsible und deadline NUR wenn genannt, sonst "".
  priority: Hoch bei Stillstand/Behinderung/kurzer Frist, sonst Mittel oder Normal.
- vobRisks: VOB-relevante Risiken. linkType: delay = Behinderung/Verzug, cost = Mehrkosten/Zusatzleistung,
  defect = Mangel, none = sonstiges.
Regeln:
- source ist IMMER genau ein Quellen-Label aus dem Input, ohne eckige Klammern.
- Erfinde nichts: keine Namen, Fristen, Zahlen oder Ereignisse, die nicht im Input stehen.
- Keine Rechtsberatung, keine Paragraphen. Leere Liste, wenn nichts zutrifft."""


def _clean_source(source: str) -> str:
    return source.strip().strip("[]").strip()


async def _llm_summary(context: str, labels: set[str]) -> dict | None:
    """LLM-Zusammenfassung; Punkte mit unbekannter Quelle werden verworfen (Traceability)."""
    result = await llm.complete_json(SYSTEM_PROMPT, context, _LLMSummary, max_tokens=1500)
    if result is None:
        return None
    ok = lambda s: _clean_source(s) in labels  # noqa: E731
    decisions = [d for d in result.keyDecisions if ok(d.source)]
    actions = [a for a in result.actionItems if ok(a.source)]
    risks = [r for r in result.vobRisks if ok(r.source)]
    return {
        "executiveSummary": [s.strip() for s in result.executiveSummary if s.strip()][:5],
        "keyDecisions": [d.text.strip() for d in decisions],
        "keyDecisionSources": [_clean_source(d.source) for d in decisions],
        "actionItems": [
            ActionItem(id=f"act-{i + 1}", task=a.task.strip(), responsible=a.responsible.strip(),
                       deadline=a.deadline.strip(), priority=a.priority, source=_clean_source(a.source))
            for i, a in enumerate(actions)
        ],
        "vobRisks": [
            VobRisk(title=r.title.strip(), description=r.description.strip(),
                    linkType=None if r.linkType == "none" else r.linkType,
                    recommendation=RECOMMENDATIONS[None if r.linkType == "none" else r.linkType],
                    source=_clean_source(r.source))
            for r in risks
        ],
    }


# ---------------------------------------------------------------- Offline-Fallback

def _offline_period(reports, notices, stats: SummaryStats) -> dict:
    executive = [_stats_sentence(stats)]
    done = [r for r in reports if (r.work_completed or "").strip()]
    if done:
        last = done[-1]
        executive.append(f"Letzter Stand ({_de(last.report_date)}): {last.work_completed.strip()}")
    risks = []
    for r in reports:
        for line in (r.deviations_incidents or "").splitlines():
            if line.strip():
                link = _detect_link(line)
                risks.append(VobRisk(title=line.strip()[:70], description=line.strip(), linkType=link,
                                     recommendation=RECOMMENDATIONS[link], source=report_label(r)))
    actions = [
        ActionItem(id=f"act-{i + 1}", task=f"{TYPE_NAMES.get(n.type, n.type)} #{n.id} prüfen und freigeben",
                   responsible="Bauleitung", deadline="", priority="Hoch", source=notice_label(n))
        for i, n in enumerate(x for x in notices if x.status == "Entwurf")
    ]
    return {"executiveSummary": executive, "keyDecisions": [], "keyDecisionSources": [],
            "actionItems": actions, "vobRisks": risks}


_TODO_RE = re.compile(r"\b(frist|bis|muss|müssen|bitte|spätestens|umgehend)\b", re.IGNORECASE)


def _offline_text(text: str, label: str) -> dict:
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]
    actions = [
        ActionItem(id=f"act-{i + 1}", task=s, responsible="", deadline="", priority="Mittel", source=label)
        for i, s in enumerate([s for s in sentences if _TODO_RE.search(s)][:5])
    ]
    risks = []
    link = _detect_link(text)
    if link:
        hit = next((s for s in sentences if _detect_link(s) == link), sentences[0])
        risks.append(VobRisk(title=f"Mögliche {TYPE_NAMES[link]}", description=hit, linkType=link,
                             recommendation=RECOMMENDATIONS[link], source=label))
    return {"executiveSummary": sentences[:2], "keyDecisions": [], "keyDecisionSources": [],
            "actionItems": actions, "vobRisks": risks}


# ---------------------------------------------------------------- Einstiegspunkte

async def summarize_period(session: Session, project: Project, period: Literal["week", "month"],
                           ref_date: dt.date) -> SummaryResponse:
    """Zusammenfassung einer Woche/eines Monats für ein Projekt."""
    start, end = resolve_period(period, ref_date)
    reports, notes, notices = collect(session, project.id, start, end)
    stats = compute_stats(reports, notices)

    if period == "week":
        title = f"Wochenzusammenfassung KW {start.isocalendar().week} ({_de(start)}–{_de(end)}) • {project.name}"
    else:
        title = f"Monatszusammenfassung {MONTHS_DE[start.month - 1]} {start.year} • {project.name}"

    blocks = build_blocks(reports, notes, notices)
    labels = [label for label, _ in blocks]
    trace = (f"Ausgewertet: {len(reports)} Tagesberichte, {len(notes)} Notizen, {len(notices)} Schreiben "
             f"({_de(start)}–{_de(end)}). Jeder Punkt nennt seine Quelle; Kennzahlen sind berechnet, nicht KI-generiert.")

    if not blocks:
        # Nichts im Zeitraum → kein LLM-Aufruf (spart Tokens), trotzdem normale Antwortform.
        content, mode = {"executiveSummary": [f"Keine Einträge im Zeitraum {_de(start)}–{_de(end)}."],
                         "keyDecisions": [], "keyDecisionSources": [], "actionItems": [], "vobRisks": []}, "offline"
    else:
        content = await _llm_summary(_fit(blocks), set(labels))
        mode = "ai"
        if content is None:
            content, mode = _offline_period(reports, notices, stats), "offline"
        else:
            # Kennzahlen immer aus Code voranstellen – nie vom LLM geschätzt.
            content["executiveSummary"].insert(0, _stats_sentence(stats))

    return SummaryResponse(title=title, traceabilityNotes=trace, sources=labels, periodFrom=start,
                           periodTo=end, stats=stats, mode=mode, **content)


async def summarize_text(text: str, source_type: str | None, project: Project | None) -> SummaryResponse:
    """Zusammenfassung eines freien Texts (E-Mail, Protokoll, Tagebuchauszug)."""
    label = SOURCE_TYPE_LABELS.get(source_type or "", "Text")
    title = f"Zusammenfassung: {label}" + (f" • {project.name}" if project else "")
    clipped = text.strip()[:MAX_CONTEXT_CHARS]
    content = await _llm_summary(f"[{label}] {clipped}", {label})
    mode = "ai"
    if content is None:
        content, mode = _offline_text(clipped, label), "offline"
    trace = f"Zusammengefasst aus {label} ({len(text.strip())} Zeichen)."
    if len(text.strip()) > MAX_CONTEXT_CHARS:
        trace += f" Nur die ersten {MAX_CONTEXT_CHARS} Zeichen ausgewertet."
    return SummaryResponse(title=title, traceabilityNotes=trace, sources=[label], mode=mode, **content)

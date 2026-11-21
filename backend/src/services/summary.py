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

from src.models import (
    Company,
    ConstructionPlan,
    Contract,
    DailyReport,
    FormalNotice,
    PlanTask,
    Project,
    SiteNote,
    UserProfile,
)
from src.schemas.summary import (
    ActionItem,
    ContractContact,
    ContractFacts,
    LinkType,
    SummaryResponse,
    SummaryStats,
    VobRisk,
)
from src.services import contract_parse, llm, offline_rules
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


def resolve_period(period: Literal["day", "week", "month"], ref_date: dt.date) -> tuple[dt.date, dt.date]:
    """Zeitraum zu einem Stichtag: Tag = Stichtag, Woche = Montag–Sonntag, Monat = 1. bis letzter Tag."""
    if period == "day":
        return ref_date, ref_date
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


async def _llm_summary(context: str, labels: set[str], single_source: str | None = None) -> dict | None:
    """LLM-Zusammenfassung mit Quelle je Punkt (Traceability).

    Zeitraum-Modus (mehrere Berichte/Briefe): Punkte, deren Quelle kein Label aus dem Input ist,
    werden verworfen – sonst könnte die KI eine Quelle erfinden.
    Text-Modus (`single_source` gesetzt): Es gibt nur EIN Dokument, also stammt jeder Punkt daraus.
    Die KI nennt dort oft eine inhaltliche Quelle ("Baubesprechung 21.11.") statt des Labels "Text";
    früher wurden dadurch alle Beschlüsse/Punkte/Risiken verworfen. Jetzt bekommt jeder Punkt das Label.
    """
    result = await llm.complete_json(SYSTEM_PROMPT, context, _LLMSummary, max_tokens=1500)
    if result is None:
        return None
    if single_source:
        for item in (*result.keyDecisions, *result.actionItems, *result.vobRisks):
            item.source = single_source
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

async def summarize_period(session: Session, project: Project, period: Literal["day", "week", "month"],
                           ref_date: dt.date) -> SummaryResponse:
    """Zusammenfassung eines Tages/einer Woche/eines Monats für ein Projekt."""
    start, end = resolve_period(period, ref_date)
    reports, notes, notices = collect(session, project.id, start, end)
    stats = compute_stats(reports, notices)

    if period == "day":
        title = f"Tageszusammenfassung {_de(start)} • {project.name}"
    elif period == "week":
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
    content = await _llm_summary(f"[{label}] {clipped}", {label}, single_source=label)
    mode = "ai"
    if content is None:
        content, mode = _offline_text(clipped, label), "offline"
    trace = f"Zusammengefasst aus {label} ({len(text.strip())} Zeichen)."
    if len(text.strip()) > MAX_CONTEXT_CHARS:
        trace += f" Nur die ersten {MAX_CONTEXT_CHARS} Zeichen ausgewertet."
    return SummaryResponse(title=title, traceabilityNotes=trace, sources=[label], mode=mode, **content)


# ---------------------------------------------------------------- Vertrag zusammenfassen

class _LLMContractContact(BaseModel):
    name: str
    role: str
    company: str
    phone: str
    email: str
    note: str


class _LLMContractSummary(BaseModel):
    workforce: str
    location: str
    schedule: str
    scope: str
    projectLeads: list[str]
    contacts: list[_LLMContractContact]
    vobNotes: str
    executiveSummary: list[str]
    keyDecisions: list[_LLMDecision]
    actionItems: list[_LLMAction]
    vobRisks: list[_LLMRisk]


CONTRACT_SYSTEM_PROMPT = """Du bist Assistent eines deutschen Bauleiters und fasst einen Bauvertrag bzw. Nachunternehmervertrag strukturiert zusammen.
Jeder Block im Input beginnt mit seinem Quellen-Label in eckigen Klammern, z. B. [Vertragstext], [Vertragsdaten], [Stammdaten], [Bauzeitenplan].

Beantworte auf Deutsch, sachlich, präzise und knapp:
- workforce: Wie viele Personen / Arbeitskräfte sind gestellt (Sollstärke, Kolonnenstärke, Mindestbesetzung)?
- location: WO wird gearbeitet (Baustelle, Bauvorhaben, Bauteil, Haus, Achse, Geschoss, Adresse)?
- schedule: WANN (Ausführungsbeginn, Fertigstellung, Meilensteine, Reaktions-/Anzeigefristen)?
- scope: WAS ist geschuldet (Gewerk, Leistungsumfang, zentrale Aufgaben/Lieferungen)?
- projectLeads: Wer sind die Projektverantwortlichen (Auftraggeber, Projektleitung, Bauleitung, Bauüberwachung, verantwortliche Bau-/Projektleiter der Firma)?
- contacts: Wen muss der Bauleiter bei Fragen kontaktieren (Name, Rolle, Firma, Telefon, E-Mail, wofür zuständig)?
- vobNotes: Wichtige VOB/B- oder Vertragsbesonderheiten (z. B. Anzeigefristen für Behinderung/Mängel, Vertragsstrafen).
- executiveSummary: 3–5 prägnante Kernaussagen für den Bauleiter (je 1 Satz).
- keyDecisions: Zentrale vertragliche Festlegungen (z. B. Sollstärke, Termine, Abnahmen) mit source.
- actionItems: Wichtige Pflichten / Fristen / Rücksprachen für die Bauleitung mit responsible, deadline, priority, source.
- vobRisks: VOB-/Termin-/Personalrisiken aus dem Vertrag (linkType: delay | cost | defect | none) mit source.

Regeln:
- source ist IMMER genau ein Quellen-Label aus dem Input (ohne eckige Klammern).
- Erfinde NICHTS: Keine Personen, Telefonnummern, E-Mails, Zahlen oder Daten erfinden. Wenn etwas nicht im Input steht, lasse das Feld leer ("" oder []).
- Keine Rechtsberatung."""

_LOC_LINE_RE = re.compile(
    r"\b(?:Baustelle|Bauvorhaben|Einsatzort|Standort|Leistungsort|Ausführungsort|Bauteil|Achse|Haus\s+[A-Z0-9]|Geschoss)\b",
    re.IGNORECASE,
)
_SCOPE_LINE_RE = re.compile(
    r"\b(?:Leistungsgegenstand|Leistungsumfang|Vertragsgegenstand|Gegenstand des Vertrags|Gewerk|Ausführungsleistungen|Auftragsumfang)\b",
    re.IGNORECASE,
)
_LEAD_LINE_RE = re.compile(
    r"\b(?:Projektleiter|Projektleitung|Oberbauleiter|Bauleiter|Bauleitung|Bauüberwachung|Auftraggeber|Bauherr|Verantwortlich(?:er|e)?|Geschäftsführer)\b",
    re.IGNORECASE,
)
_CONTACT_LINE_RE = re.compile(
    r"\b(?:Ansprechpartner|Kontakt|Rückfragen|Erreichbar|Polier|Vorarbeiter|Koordinator|Tel\.?|Telefon|Mobil|E-?Mail)\b",
    re.IGNORECASE,
)
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"(?:\+?\d[\d\s/\-()]{6,}\d)")


def _dedupe_strs(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        s = item.strip()
        key = s.lower()
        if s and key not in seen:
            seen.add(key)
            out.append(s)
    return out


def _matching_companies(session: Session, contract: Contract) -> tuple[Company | None, Company | None, Company | None]:
    """Findet (Nachunternehmer-Firma, Auftraggeber-Firma, Eigenes Unternehmen) aus den Stammdaten."""
    companies = list(session.exec(select(Company)).all())
    cname = (contract.contractor_name or "").strip().lower()
    ctrade = (contract.trade or "").strip().lower()
    contractor_co: Company | None = None
    client_co: Company | None = None
    own_co: Company | None = None

    for c in companies:
        if c.company_type == "client" and client_co is None:
            client_co = c
        elif c.company_type == "own" and own_co is None:
            own_co = c
        if cname and c.name.strip().lower() == cname:
            contractor_co = c
    if contractor_co is None and cname:
        for c in companies:
            if cname in c.name.strip().lower() or c.name.strip().lower() in cname:
                contractor_co = c
                break
    if contractor_co is None and ctrade:
        for c in companies:
            if c.company_type == "subcontractor" and c.trade and ctrade in c.trade.strip().lower():
                contractor_co = c
                break
    return contractor_co, client_co, own_co


def _matching_plan_tasks(session: Session, contract: Contract) -> list[PlanTask]:
    plans = list(session.exec(select(ConstructionPlan).where(ConstructionPlan.project_id == contract.project_id)).all())
    if not plans:
        return []
    plan_ids = [p.id for p in plans if p.id is not None]
    tasks = list(session.exec(select(PlanTask).where(PlanTask.plan_id.in_(plan_ids))).all())
    if contract.trade:
        ct = contract.trade.strip().lower()
        matched = [t for t in tasks if t.trade and (ct in t.trade.lower() or t.trade.lower() in ct)]
        if matched:
            return matched
    return tasks


def _extract_lines(text: str, rx: re.Pattern[str], limit: int = 3) -> list[str]:
    hits: list[str] = []
    for raw in text.splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        if not line or len(line) < 4:
            continue
        if rx.search(line):
            hits.append(line[:220])
            if len(hits) >= limit:
                break
    return hits


def _extract_contacts_from_text(text: str, fallback_company: str) -> list[ContractContact]:
    contacts: list[ContractContact] = []
    seen: set[str] = set()
    for raw in text.splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        if not line:
            continue
        if not (_CONTACT_LINE_RE.search(line) or _EMAIL_RE.search(line) or _LEAD_LINE_RE.search(line)):
            continue
        email_m = _EMAIL_RE.search(line)
        phone_m = _PHONE_RE.search(line)
        if not (email_m or phone_m or "ansprechpartner" in line.lower() or "rückfragen" in line.lower() or "bauleiter" in line.lower() or "projektleiter" in line.lower()):
            continue
        email = email_m.group(0) if email_m else ""
        phone = phone_m.group(0).strip() if phone_m else ""
        # Label vor ':' oder ohne Tel/Mail als Name/Rolle verwenden
        cleaned = line
        if email:
            cleaned = cleaned.replace(email, "")
        if phone:
            cleaned = cleaned.replace(phone, "")
        cleaned = re.sub(r"\b(?:Tel\.?|Telefon|Mobil|E-?Mail|Mail)\s*:?", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"[,;|•]+", " ", cleaned).strip(" :-")
        role = ""
        name = cleaned
        if ":" in cleaned:
            left, right = cleaned.split(":", 1)
            if left.strip() and right.strip():
                role, name = left.strip()[:60], right.strip()[:80]
        if not name and not email and not phone:
            continue
        key = f"{name.lower()}|{email.lower()}|{phone}"
        if key in seen:
            continue
        seen.add(key)
        contacts.append(ContractContact(
            name=name[:80] or "Ansprechpartner laut Vertrag",
            role=role,
            company=fallback_company,
            phone=phone,
            email=email,
            note="Aus Vertragstext",
        ))
        if len(contacts) >= 5:
            break
    return contacts


def _merge_contacts(primary: list[ContractContact], secondary: list[ContractContact]) -> list[ContractContact]:
    out: list[ContractContact] = []
    seen: set[tuple[str, str, str]] = set()
    for c in [*primary, *secondary]:
        name = (c.name or "").strip()
        email = (c.email or "").strip()
        phone = (c.phone or "").strip()
        if not (name or email or phone):
            continue
        key = (name.lower(), email.lower(), re.sub(r"\D", "", phone))
        if key in seen:
            continue
        seen.add(key)
        out.append(ContractContact(
            name=name or c.company or "Kontakt",
            role=(c.role or "").strip(),
            company=(c.company or "").strip(),
            phone=phone,
            email=email,
            note=(c.note or "").strip(),
        ))
    return out


def _build_contract_fallback_facts(
    contract: Contract,
    project: Project | None,
    contractor_co: Company | None,
    client_co: Company | None,
    own_co: Company | None,
    tasks: list[PlanTask],
    profile: UserProfile | None,
) -> tuple[ContractFacts, dict[str, contract_parse.ParsedField]]:
    text = (contract.extracted_text or "").strip()
    parsed = contract_parse.offline_parse(text) if text else {}

    # 1. Gestellte Personen / Sollstärke
    pw = contract.planned_workforce
    if pw is None and "planned_workforce" in parsed:
        pw = int(parsed["planned_workforce"].value)
    if pw is not None:
        workforce = f"{pw} Person(en) / Arbeitskräfte (vertragliche Sollstärke)"
    else:
        wf_lines = _extract_lines(text, re.compile(r"\b(?:Sollstärke|Mindestbesetzung|Arbeitskräfte|Personal|Monteure|Personen)\b", re.IGNORECASE), 1)
        workforce = wf_lines[0] if wf_lines else "Keine Personenanzahl / Sollstärke im Vertrag angegeben"

    # 2. Wo
    loc_parts: list[str] = []
    if text:
        loc_parts.extend(_extract_lines(text, _LOC_LINE_RE, 2))
    task_locs = _dedupe_strs([t.location for t in tasks if t.location])
    if task_locs:
        loc_parts.append("Bauabschnitte / Bereiche (Bauzeitenplan): " + ", ".join(task_locs))
    if project and project.location:
        loc_parts.append(f"Projektstandort: {project.location}")
    location = " | ".join(_dedupe_strs(loc_parts)) or "Kein Einsatzort angegeben"

    # 3. Wann
    sched_parts: list[str] = []
    start_s = parsed["execution_start"].value if "execution_start" in parsed else None
    end_s = parsed["execution_end"].value if "execution_end" in parsed else None
    if start_s or end_s:
        sched_parts.append(f"Vertraglicher Zeitraum: {start_s or '?'} – {end_s or '?'}")
    task_starts = [t.planned_start for t in tasks if t.planned_start]
    task_ends = [t.planned_end for t in tasks if t.planned_end]
    if task_starts or task_ends:
        s_min = _de(min(task_starts)) if task_starts else "?"
        e_max = _de(max(task_ends)) if task_ends else "?"
        sched_parts.append(f"Laut Bauzeitenplan ({len(tasks)} Vorgänge): {s_min} – {e_max}")
    elif project and (project.start_date or project.end_date):
        sched_parts.append(f"Projektlaufzeit: {project.start_date or '?'} – {project.end_date or '?'}")
    if contract.vob_notes:
        sched_parts.append(f"Fristen/Hinweise: {contract.vob_notes}")
    schedule = " | ".join(_dedupe_strs(sched_parts)) or "Kein Ausführungszeitraum angegeben"

    # 4. Was
    scope_parts: list[str] = []
    if contract.trade:
        scope_parts.append(f"Gewerk: {contract.trade}")
    if text:
        scope_parts.extend(_extract_lines(text, _SCOPE_LINE_RE, 2))
    if tasks:
        task_titles = [f"{t.task_code + ' ' if t.task_code else ''}{t.title}" for t in tasks[:5]]
        scope_parts.append("Vorgänge: " + ", ".join(task_titles) + (f" (+{len(tasks) - 5} weitere)" if len(tasks) > 5 else ""))
    if not scope_parts:
        scope_parts.append(contract.title)
    scope = " | ".join(_dedupe_strs(scope_parts))

    # 5. Projektverantwortliche
    leads: list[str] = []
    if text:
        leads.extend(_extract_lines(text, _LEAD_LINE_RE, 4))
    if project and project.client:
        leads.append(f"Auftraggeber / Bauherr: {project.client}" + (f" (Ansprechpartner: {client_co.contact_person})" if client_co and client_co.contact_person else ""))
    if contract.contractor_name:
        leads.append(f"Auftragnehmer / Firma: {contract.contractor_name}" + (f" ({contractor_co.contact_person})" if contractor_co and contractor_co.contact_person else ""))
    if profile and profile.full_name:
        leads.append(f"Eigene Bauleitung: {profile.full_name}" + (f" ({profile.company})" if profile.company else ""))
    elif own_co:
        leads.append(f"Eigenes Unternehmen: {own_co.name}" + (f" ({own_co.contact_person})" if own_co.contact_person else ""))
    leads = _dedupe_strs(leads)

    # 6. Kontakte bei Fragen für den Bauleiter
    db_contacts: list[ContractContact] = []
    if contractor_co and (contractor_co.contact_person or contractor_co.phone or contractor_co.email):
        db_contacts.append(ContractContact(
            name=contractor_co.contact_person or contractor_co.name,
            role=f"Ansprechpartner {contract.trade or 'Nachunternehmer'}",
            company=contractor_co.name,
            phone=contractor_co.phone or "",
            email=contractor_co.email or "",
            note="Bei Rückfragen zur Ausführung & Personalgestellung (Stammdaten)",
        ))
    elif contract.contractor_name:
        db_contacts.append(ContractContact(
            name=contract.contractor_name,
            role=f"Vertragspartner ({contract.trade or 'Gewerk'})",
            company=contract.contractor_name,
            note="Vertragspartner laut Vertragsdaten (Details ggf. in Stammdaten → Firmen ergänzen)",
        ))
    if client_co and (client_co.contact_person or client_co.phone or client_co.email):
        db_contacts.append(ContractContact(
            name=client_co.contact_person or client_co.name,
            role="Auftraggeber / Bauherr",
            company=client_co.name,
            phone=client_co.phone or "",
            email=client_co.email or "",
            note="Bei Rückfragen zu Plänen, Freigaben & Nachträgen",
        ))
    elif project and project.client:
        db_contacts.append(ContractContact(
            name=project.client,
            role="Auftraggeber / Bauherr",
            company=project.client,
            note="Ansprechpartner Bauherrseite (Projektstammdaten)",
        ))

    text_contacts = _extract_contacts_from_text(text, contract.contractor_name or "") if text else []
    contacts = _merge_contacts(text_contacts, db_contacts)

    facts = ContractFacts(
        contractTitle=contract.title,
        contractorName=contract.contractor_name or (contractor_co.name if contractor_co else ""),
        trade=contract.trade or (contractor_co.trade if contractor_co and contractor_co.trade else ""),
        statusLabel="Aktiv" if contract.is_active is not False else "Inaktiv",
        workforce=workforce,
        location=location,
        schedule=schedule,
        scope=scope,
        projectLeads=leads,
        contacts=contacts,
        vobNotes=contract.vob_notes or (contractor_co.vob_rules if contractor_co and contractor_co.vob_rules else ""),
    )
    return facts, parsed


async def summarize_contract(session: Session, contract: Contract, project: Project | None) -> SummaryResponse:
    """Fasst einen Vertrag inkl. Stammdaten & Bauzeitenplan für die Bauleitung zusammen."""
    contractor_co, client_co, own_co = _matching_companies(session, contract)
    tasks = _matching_plan_tasks(session, contract)
    profile = session.exec(select(UserProfile).order_by(UserProfile.id)).first()

    fallback_facts, parsed = _build_contract_fallback_facts(
        contract, project, contractor_co, client_co, own_co, tasks, profile
    )

    # Kontext-Blöcke für das LLM bauen
    blocks: list[tuple[str, str]] = []
    meta_parts = [
        f"Vertragstitel: {contract.title}",
        f"Status: {'Aktiv' if contract.is_active is not False else 'Inaktiv'}",
    ]
    if contract.contractor_name:
        meta_parts.append(f"Vertragspartner: {contract.contractor_name}")
    if contract.trade:
        meta_parts.append(f"Gewerk: {contract.trade}")
    if contract.planned_workforce is not None:
        meta_parts.append(f"Vertragliche Sollstärke: {contract.planned_workforce} Personen/Arbeitskräfte")
    if contract.vob_notes:
        meta_parts.append(f"VOB-Hinweise: {contract.vob_notes}")
    blocks.append(("Vertragsdaten", " | ".join(meta_parts)))

    master_parts: list[str] = []
    if project:
        master_parts.append(f"Projekt: {project.name}" + (f" ({project.number})" if project.number else ""))
        if project.location:
            master_parts.append(f"Projektstandort: {project.location}")
        if project.client:
            master_parts.append(f"Auftraggeber/Bauherr: {project.client}")
        if project.start_date or project.end_date:
            master_parts.append(f"Projektbauzeit: {project.start_date or '?'} – {project.end_date or '?'}")
    if contractor_co:
        master_parts.append(
            f"Firma (Stammdaten): {contractor_co.name}"
            + (f", Ansprechpartner: {contractor_co.contact_person}" if contractor_co.contact_person else "")
            + (f", Tel: {contractor_co.phone}" if contractor_co.phone else "")
            + (f", E-Mail: {contractor_co.email}" if contractor_co.email else "")
            + (f", Adresse: {contractor_co.address}" if contractor_co.address else "")
        )
    if client_co:
        master_parts.append(
            f"Auftraggeber-Kontakt: {client_co.name}"
            + (f", Ansprechpartner: {client_co.contact_person}" if client_co.contact_person else "")
            + (f", Tel: {client_co.phone}" if client_co.phone else "")
            + (f", E-Mail: {client_co.email}" if client_co.email else "")
        )
    if profile and profile.full_name:
        master_parts.append(f"Eigene Bauleitung: {profile.full_name} ({profile.role or 'Bauleiter'})")
    if master_parts:
        blocks.append(("Stammdaten", " | ".join(master_parts)))

    if tasks:
        task_lines = [
            f"{t.task_code or ''} {t.title} ({t.trade or 'ohne Gewerk'}, Ort: {t.location or 'k. A.'}, Zeitraum: {t.planned_start or '?'} bis {t.planned_end or '?'})"
            for t in tasks[:12]
        ]
        blocks.append(("Bauzeitenplan", " ; ".join(task_lines)))

    has_pdf_text = bool(contract.extracted_text and contract.extracted_text.strip())
    if has_pdf_text:
        blocks.append(("Vertragstext", contract_parse.excerpt(contract.extracted_text.strip())))

    labels = [lbl for lbl, _ in blocks]
    label_set = set(labels)

    llm_res: _LLMContractSummary | None = None
    if has_pdf_text:
        llm_res = await llm.complete_json(CONTRACT_SYSTEM_PROMPT, _fit(blocks), _LLMContractSummary, max_tokens=1600)

    if llm_res is not None:
        mode: Literal["ai", "offline"] = "ai"
        llm_contacts = [
            ContractContact(
                name=c.name.strip(),
                role=c.role.strip(),
                company=c.company.strip(),
                phone=c.phone.strip(),
                email=c.email.strip(),
                note=c.note.strip(),
            )
            for c in llm_res.contacts
            if c.name.strip() or c.phone.strip() or c.email.strip()
        ]
        facts = ContractFacts(
            contractTitle=contract.title,
            contractorName=contract.contractor_name or fallback_facts.contractorName,
            trade=contract.trade or fallback_facts.trade,
            statusLabel=fallback_facts.statusLabel,
            workforce=llm_res.workforce.strip() or fallback_facts.workforce,
            location=llm_res.location.strip() or fallback_facts.location,
            schedule=llm_res.schedule.strip() or fallback_facts.schedule,
            scope=llm_res.scope.strip() or fallback_facts.scope,
            projectLeads=_dedupe_strs([*llm_res.projectLeads, *fallback_facts.projectLeads]),
            contacts=_merge_contacts(llm_contacts, fallback_facts.contacts),
            vobNotes=llm_res.vobNotes.strip() or fallback_facts.vobNotes,
        )
        ok = lambda s: _clean_source(s) in label_set  # noqa: E731
        decisions = [d for d in llm_res.keyDecisions if ok(d.source)]
        actions = [a for a in llm_res.actionItems if ok(a.source)]
        risks = [r for r in llm_res.vobRisks if ok(r.source)]
        executive = [s.strip() for s in llm_res.executiveSummary if s.strip()][:5]
        if not executive:
            executive = [
                f"Personal / Sollstärke: {facts.workforce}",
                f"Einsatzort & Zeitraum: {facts.location} • {facts.schedule}",
                f"Leistungsumfang: {facts.scope}",
            ]
        key_decisions = [d.text.strip() for d in decisions]
        key_decision_sources = [_clean_source(d.source) for d in decisions]
        action_items = [
            ActionItem(
                id=f"act-{i + 1}",
                task=a.task.strip(),
                responsible=a.responsible.strip(),
                deadline=a.deadline.strip(),
                priority=a.priority,
                source=_clean_source(a.source),
            )
            for i, a in enumerate(actions)
        ]
        vob_risks = [
            VobRisk(
                title=r.title.strip(),
                description=r.description.strip(),
                linkType=None if r.linkType == "none" else r.linkType,
                recommendation=RECOMMENDATIONS[None if r.linkType == "none" else r.linkType],
                source=_clean_source(r.source),
            )
            for r in risks
        ]
    else:
        mode = "offline"
        facts = fallback_facts
        executive = [
            f"Vertrag: {facts.contractTitle} ({facts.statusLabel})"
            + (f" mit {facts.contractorName}" if facts.contractorName else "")
            + (f" – Gewerk {facts.trade}" if facts.trade else ""),
            f"Gestellte Personen: {facts.workforce}",
            f"Wo & Wann: {facts.location} | {facts.schedule}",
            f"Leistungsumfang (Was): {facts.scope}",
        ]
        if facts.contacts:
            first_c = facts.contacts[0]
            contact_str = ", ".join(p for p in (first_c.name, first_c.role, first_c.phone, first_c.email) if p)
            executive.append(f"Ansprechpartner bei Fragen: {contact_str}")

        key_decisions = []
        key_decision_sources = []
        if contract.planned_workforce is not None:
            key_decisions.append(f"Vertragliche Sollstärke: {contract.planned_workforce} Arbeitskräfte")
            key_decision_sources.append("Vertragsdaten")
        if "execution_start" in parsed or "execution_end" in parsed:
            s_val = parsed.get("execution_start").value if "execution_start" in parsed else "?"
            e_val = parsed.get("execution_end").value if "execution_end" in parsed else "?"
            key_decisions.append(f"Vereinbarter Ausführungszeitraum: {s_val} bis {e_val}")
            key_decision_sources.append("Vertragstext")
        if facts.vobNotes:
            key_decisions.append(facts.vobNotes)
            key_decision_sources.append("Vertragsdaten")

        action_items = []
        if contract.planned_workforce is not None:
            action_items.append(ActionItem(
                id="act-1",
                task=f"Tägliche Anwesenheit gegen Sollstärke ({contract.planned_workforce} Personen) im Bautagesbericht prüfen",
                responsible="Bauleitung",
                deadline="",
                priority="Mittel",
                source="Vertragsdaten",
            ))
        if facts.vobNotes:
            action_items.append(ActionItem(
                id=f"act-{len(action_items) + 1}",
                task=f"Vertrags-/VOB-Vorgabe beachten: {facts.vobNotes}",
                responsible="Bauleitung",
                deadline="",
                priority="Hoch" if "frist" in facts.vobNotes.lower() or "binnen" in facts.vobNotes.lower() else "Mittel",
                source="Vertragsdaten",
            ))

        vob_risks = []
        combined_text = "\n".join(filter(None, [contract.vob_notes or "", contract.extracted_text or ""]))
        link = _detect_link(combined_text)
        if link or facts.vobNotes:
            vob_risks.append(VobRisk(
                title="Vertragliche VOB-/Fristenregelung beachten",
                description=facts.vobNotes or "Im Vertragstext sind VOB- oder Fristenhinweise enthalten.",
                linkType=link,
                recommendation=RECOMMENDATIONS[link],
                source="Vertragsdaten" if facts.vobNotes else "Vertragstext",
            ))

    title = f"Vertragszusammenfassung: {contract.title}" + (f" • {project.name}" if project else "")
    trace = (
        f"Ausgewertet: {', '.join(labels)}."
        + (f" Vertragstext ({len(contract.extracted_text.strip())} Zeichen)." if has_pdf_text else " Kein PDF-Volltext hinterlegt – Zusammenfassung basiert auf Vertragsdaten, Stammdaten und Bauzeitenplan.")
    )
    return SummaryResponse(
        title=title,
        executiveSummary=executive,
        keyDecisions=key_decisions,
        keyDecisionSources=key_decision_sources,
        actionItems=action_items,
        vobRisks=vob_risks,
        traceabilityNotes=trace,
        sources=labels,
        contractFacts=facts,
        mode=mode,
    )


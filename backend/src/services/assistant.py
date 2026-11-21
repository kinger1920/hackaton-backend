"""Projekt-Assistent „Frag dein Projekt“ (Kern von POST /api/assistant/ask).

Aufgabenteilung (wie bei /api/summarize):
- Code:  Projektdaten sammeln (Stammdaten, Firmen/Verträge, Soll/Ist je Vorgang, Tagesberichte,
         Tagebuchnotizen, Briefe, Termine), jedem Block ein Quellen-Label geben, die zur Frage
         passendsten Blöcke auswählen und prüfen, dass genannte Quellen wirklich existieren.
- LLM:   Antwort formulieren – NUR aus dem mitgegebenen Kontext.
Fällt das LLM aus (kein Key, Timeout, 429), beantwortet ein Regel-Fallback typische Fragen
(Verzug, Briefe/Freigaben, Verträge/Sollstärke, Behinderungen/Vorkommnisse) direkt aus den Daten.
"""

import datetime as dt
import re
import unicodedata

from pydantic import BaseModel
from sqlmodel import Session, select

from src.models import Appointment, Company, Contract, FormalNotice, Project
from src.schemas.analysis import WorkPackage
from src.services import analysis, llm
from src.services.letters import TYPE_NAMES
from src.services.summary import (
    MAX_CONTEXT_CHARS,
    _de,
    _fit,
    collect,
    note_label,
    notice_label,
    report_label,
)

# Zeitraum, aus dem Tagesberichte/Notizen/Briefe in den Kontext kommen.
LOOKBACK_DAYS = 60
# Vertragstexte sind lang → nur ein Auszug je Vertrag.
CONTRACT_EXCERPT_CHARS = 1_500

STOPWORDS = {
    "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einer", "und", "oder", "ist", "sind",
    "war", "waren", "wir", "ich", "hat", "haben", "hatte", "hatten", "bei", "mit", "von", "vom", "zum", "zur",
    "im", "in", "an", "am", "auf", "aus", "fur", "für", "noch", "nicht", "wie", "was", "wer", "wo", "warum",
    "welche", "welcher", "welches", "wann", "viele", "laut", "gab", "es", "zu", "uns", "unser", "unsere",
    "letzte", "letzten", "woche", "heute", "gestern", "sich", "als", "so", "auch", "nur", "bis",
}

SYSTEM_PROMPT = """Du bist der Projekt-Assistent einer Bauleitung. Beantworte die Frage des Bauleiters
ausschließlich mit den Informationen aus dem Kontext. Jeder Kontext-Block beginnt mit seiner Quelle in
eckigen Klammern, z. B. [Tagesbericht 17.11.2026].

Regeln:
- Antworte auf Deutsch, knapp und konkret (max. 6 Sätze oder eine kurze Liste). Nenne Zahlen und Daten.
- Erfinde nichts. Steht die Antwort nicht im Kontext, sage das klar und nenne, was fehlt.
- `sources`: genau die Quellen-Labels (ohne Klammern), auf die sich die Antwort stützt – nur Labels aus dem Kontext.
- Keine Rechtsberatung: Bei VOB/B-Fragen nur sagen, welches Schreiben zu prüfen ist."""


class _LLMAnswer(BaseModel):
    answer: str
    sources: list[str]


# ---------------------------------------------------------------- Kontext

def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in text if not unicodedata.combining(c))


def keywords(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", _norm(text))
    return {w for w in words if len(w) > 2 and w not in STOPWORDS}


def _project_block(project: Project) -> tuple[str, str]:
    facts = [f"Projekt: {project.name}"]
    for label, value in (("Nr.", project.number), ("Auftraggeber", project.client), ("Ort", project.location),
                         ("Phase", project.phase), ("Status", project.status), ("Bauform", project.construction_type),
                         ("Vertragsart", project.contract_type)):
        if value:
            facts.append(f"{label}: {value}")
    if project.start_date or project.end_date:
        start = _de(project.start_date) if project.start_date else "?"
        end = _de(project.end_date) if project.end_date else "?"
        facts.append(f"Bauzeit: {start} bis {end}")
    if project.vob_b_agreed is not None:
        facts.append("VOB/B vereinbart" if project.vob_b_agreed else "VOB/B nicht vereinbart")
    if project.vob_notes:
        facts.append(f"VOB-Hinweise: {project.vob_notes}")
    return "Projektstammdaten", " | ".join(facts)


def contract_label(c: Contract) -> str:
    return f"Vertrag #{c.id} {c.contractor_name or c.title}"


def _contract_block(c: Contract) -> tuple[str, str]:
    parts = [f"Titel: {c.title}"]
    if c.contractor_name:
        parts.append(f"Firma: {c.contractor_name}")
    if c.trade:
        parts.append(f"Gewerk: {c.trade}")
    if c.planned_workforce is not None:
        parts.append(f"Vertragliche Sollstärke: {c.planned_workforce} Arbeitskräfte")
    parts.append("aktiv" if c.is_active is not False else "inaktiv")
    if c.vob_notes:
        parts.append(f"VOB-Regelungen: {c.vob_notes}")
    if c.extracted_text:
        parts.append(f"Vertragstext (Auszug): {c.extracted_text[:CONTRACT_EXCERPT_CHARS].strip()}")
    return contract_label(c), " | ".join(parts)


def company_label(c: Company) -> str:
    return f"Firma {c.name}"


def _company_block(c: Company) -> tuple[str, str]:
    kind = {"own": "eigene Firma", "client": "Auftraggeber", "subcontractor": "Nachunternehmer"}.get(
        c.company_type, c.company_type)
    parts = [kind]
    for label, value in (("Gewerk", c.trade), ("Ansprechpartner", c.contact_person), ("Telefon", c.phone),
                         ("E-Mail", c.email), ("Adresse", c.address), ("VOB-Regeln", c.vob_rules)):
        if value:
            parts.append(f"{label}: {value}")
    return company_label(c), " | ".join(parts)


ANALYSIS_LABEL = "Soll/Ist-Analyse"


def _analysis_block(packages: list[WorkPackage], ref: dt.date) -> tuple[str, str]:
    lines = [f"Stichtag {_de(ref)}"]
    for p in packages:
        status = {"delayed": "Verzug", "warning": "Warnung", "ontrack": "im Plan"}[p.status]
        lines.append(
            f"{p.name} ({p.subcontractor or p.trade}{', ' + p.location if p.location else ''}): "
            f"Soll {p.planPercent} %, Ist {p.actualPercent} %, {status}, Verzug {p.delayDays:g} AT, "
            f"Soll-Ende {p.planDate}, Ist {p.actualDate}"
        )
    return ANALYSIS_LABEL, " | ".join(lines)


def appointment_label(a: Appointment) -> str:
    return f"Termin {_de(a.date)} {a.title}"


def gather(session: Session, project: Project, ref: dt.date):
    """Alle Projektdaten als (Label, Text)-Blöcke + Rohdaten für den Offline-Fallback."""
    start = ref - dt.timedelta(days=LOOKBACK_DAYS)
    reports, notes, notices = collect(session, project.id, start, ref)
    # Briefe unabhängig vom Erstelldatum (offene Freigaben können älter sein)
    notices = session.exec(
        select(FormalNotice).where(FormalNotice.project_id == project.id).order_by(FormalNotice.created_at)
    ).all()
    contracts = session.exec(select(Contract).where(Contract.project_id == project.id)).all()
    contractor_names = {(_norm(c.contractor_name or "")) for c in contracts if c.contractor_name}
    companies = [c for c in session.exec(select(Company)).all()
                 if c.company_type != "subcontractor" or _norm(c.name) in contractor_names]
    try:
        packages, _, _ = analysis.evaluate_tasks(session, project, ref)
    except Exception:  # Analyse darf die Antwort nie verhindern
        packages = []
    appointments = session.exec(
        select(Appointment).where(Appointment.project_id == project.id).order_by(Appointment.date)
    ).all()

    blocks: list[tuple[str, str]] = [_project_block(project)]
    if packages:
        blocks.append(_analysis_block(packages, ref))
    blocks += [_contract_block(c) for c in contracts]
    blocks += [_company_block(c) for c in companies]
    for r in reports:
        parts = []
        for label, value in (("Zusammenfassung", r.summary), ("Ausgeführt", r.work_completed),
                             ("Vorkommnisse", r.deviations_incidents), ("Lieferungen", r.deliveries)):
            if value and value.strip():
                parts.append(f"{label}: {value.strip()}")
        if r.workforce_count is not None:
            parts.append(f"Personal: {r.workforce_count}")
        if r.weather:
            parts.append(f"Wetter: {r.weather}")
        blocks.append((report_label(r), " | ".join(parts) or "(leer)"))
    blocks += [(note_label(n), n.content.strip()) for n in notes]
    for n in notices:
        blocks.append((notice_label(n), f"{TYPE_NAMES.get(n.type, n.type)}, Status {n.status}, erstellt "
                                        f"{_de(n.created_at.date())}, an {n.recipient or '–'}. Betreff: "
                                        f"{n.subject or n.title or ''}. {n.body[:400]}"))
    for a in appointments:
        blocks.append((appointment_label(a), f"{a.title} am {_de(a.date)}{' ' + a.time if a.time else ''}"
                                             f" ({a.category}{', ' + a.trade if a.trade else ''})"
                                             f"{' – ' + a.description if a.description else ''}"))
    raw = {"reports": reports, "notes": notes, "notices": notices, "contracts": contracts, "packages": packages}
    return blocks, raw


def select_blocks(blocks: list[tuple[str, str]], question: str, limit: int = MAX_CONTEXT_CHARS) -> list[tuple[str, str]]:
    """Wählt die zur Frage passendsten Blöcke, bis das Kontext-Budget erreicht ist.

    Stammdaten und Soll/Ist sind immer dabei; danach nach Wort-Überlappung, bei Gleichstand die neuesten
    (Blöcke liegen chronologisch, spätere Indizes = neuer).
    """
    q = keywords(question)
    fixed = [b for b in blocks if b[0] in ("Projektstammdaten", ANALYSIS_LABEL)]
    rest = [(i, b) for i, b in enumerate(blocks) if b not in fixed]

    def score(item):
        i, (label, text) = item
        words = keywords(f"{label} {text}")
        return (len(q & words), i)

    ranked = [b for _, b in sorted(rest, key=score, reverse=True)]
    chosen, used = list(fixed), sum(len(t) + len(lbl) for lbl, t in fixed)
    for b in ranked:
        size = len(b[0]) + len(b[1]) + 4
        if used + size > limit:
            continue
        chosen.append(b)
        used += size
    # ursprüngliche Reihenfolge beibehalten (chronologisch lesbar)
    order = {id(b): i for i, b in enumerate(blocks)}
    return sorted(chosen, key=lambda b: order.get(id(b), 0))


# ---------------------------------------------------------------- Offline-Fallback

def _has(q: str, *words: str) -> bool:
    return any(w in q for w in words)


def offline_answer(question: str, blocks: list[tuple[str, str]], raw: dict, ref: dt.date) -> tuple[str, list[str]]:
    q = _norm(question)
    packages: list[WorkPackage] = raw["packages"]
    notices = raw["notices"]
    contracts = raw["contracts"]

    if _has(q, "verzug", "ruckstand", "rueckstand", "verspat", "hinterher", "plan", "soll", "fortschritt") and packages:
        relevant = [p for p in packages if keywords(p.name) & keywords(question)] or \
                   [p for p in packages if p.status != "ontrack"] or packages
        lines = [f"- {p.name}: Soll {p.planPercent} %, Ist {p.actualPercent} %, Verzug {p.delayDays:g} Arbeitstage "
                 f"(Soll-Ende {p.planDate}, Ist {p.actualDate})" for p in relevant[:6]]
        sources = [ANALYSIS_LABEL]
        # passende Vorkommnisse aus Tagesberichten als mögliche Ursache
        causes = [r for r in raw["reports"] if (r.deviations_incidents or "").strip()
                  and keywords(r.deviations_incidents) & keywords(" ".join(p.name for p in relevant))]
        text = f"Soll/Ist zum {_de(ref)}:\n" + "\n".join(lines)
        if causes:
            last = causes[-3:]
            text += "\nGemeldete Ursachen:\n" + "\n".join(
                f"- {_de(r.report_date)}: {r.deviations_incidents.strip()[:200]}" for r in last)
            sources += [report_label(r) for r in last]
        return text, sources

    if _has(q, "brief", "schreiben", "freigegeben", "freigabe", "anzeige", "anmeldung", "mangelruge", "maengel"):
        open_ = [n for n in notices if n.status not in ("Freigegeben", "Exportiert", "approved", "exported")]
        if _has(q, "freigegeben", "freigabe", "offen") and notices:
            if not open_:
                return "Alle Briefe des Projekts sind freigegeben.", [notice_label(n) for n in notices[-5:]]
            lines = [f"- #{n.id} {TYPE_NAMES.get(n.type, n.type)} ({n.status}): {n.subject or n.title or ''}"
                     for n in open_]
            return f"{len(open_)} Brief(e) noch nicht freigegeben:\n" + "\n".join(lines), [notice_label(n) for n in open_]
        if notices:
            lines = [f"- #{n.id} {TYPE_NAMES.get(n.type, n.type)} vom {_de(n.created_at.date())} ({n.status})"
                     for n in notices[-8:]]
            return "Briefe im Projekt:\n" + "\n".join(lines), [notice_label(n) for n in notices[-8:]]

    if _has(q, "vertrag", "leute", "sollstark", "personal", "arbeitskraft", "mann", "kolonne") and contracts:
        q_words = keywords(question)
        matching = [c for c in contracts
                    if keywords(f"{c.contractor_name or ''} {c.trade or ''} {c.title}") & q_words] or contracts
        lines = [f"- {c.contractor_name or c.title} ({c.trade or 'Gewerk ?'}): Sollstärke "
                 f"{c.planned_workforce if c.planned_workforce is not None else 'nicht festgelegt'}"
                 for c in matching]
        return "Laut Verträgen:\n" + "\n".join(lines), [contract_label(c) for c in matching]

    if _has(q, "behinder", "vorkommnis", "problem", "storung", "stoerung", "unfall", "regen", "ausfall"):
        since = ref - dt.timedelta(days=7 if "woche" in q else 30)
        hits = [r for r in raw["reports"] if r.report_date >= since and (r.deviations_incidents or "").strip()]
        if hits:
            lines = [f"- {_de(r.report_date)}: {r.deviations_incidents.strip()[:220]}" for r in hits]
            return (f"Vorkommnisse seit {_de(since)}:\n" + "\n".join(lines),
                    [report_label(r) for r in hits])
        return f"Seit {_de(since)} sind in den Tagesberichten keine Vorkommnisse eingetragen.", []

    # Allgemein: die passendsten Einträge zitieren
    q_words = keywords(question)
    scored = sorted(
        ((len(q_words & keywords(f"{lbl} {txt}")), i, lbl, txt) for i, (lbl, txt) in enumerate(blocks)),
        reverse=True,
    )
    top = [(lbl, txt) for s, _, lbl, txt in scored if s > 0][:3]
    if not top:
        return ("Dazu finde ich in Tagesberichten, Tagebuch, Briefen und Verträgen nichts Passendes. "
                "Tipp: Firmen-, Vorgangs- oder Ortsnamen in die Frage aufnehmen."), []
    lines = [f"- [{lbl}] {txt[:240]}{'…' if len(txt) > 240 else ''}" for lbl, txt in top]
    return "Passende Einträge (KI offline, daher ohne Zusammenfassung):\n" + "\n".join(lines), [lbl for lbl, _ in top]


# ---------------------------------------------------------------- Einstieg

async def ask(session: Session, project: Project, question: str, ref: dt.date) -> tuple[str, list[str], str]:
    """Antwort auf eine Frage: (answer, sources, mode)."""
    blocks, raw = gather(session, project, ref)
    labels = {lbl for lbl, _ in blocks}
    context_blocks = select_blocks(blocks, question)
    user = f"Heute/Stichtag: {_de(ref)}\n\nKontext:\n{_fit(context_blocks)}\n\nFrage: {question.strip()}"
    result = await llm.complete_json(SYSTEM_PROMPT, user, _LLMAnswer, max_tokens=900)
    if result is not None and result.answer.strip():
        sources: list[str] = []
        for s in result.sources:
            s = s.strip().strip("[]").strip()
            if s in labels and s not in sources:
                sources.append(s)
        return result.answer.strip(), sources, "ai"
    answer, sources = offline_answer(question, blocks, raw, ref)
    return answer, sources, "offline"

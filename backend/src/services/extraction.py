"""Diktat → Brieftyp + Felder (Kern von POST /api/capture).

Ablauf: LLM extrahiert Fakten (in jeder Eingabesprache, Ausgabe Deutsch). Klappt das
nicht, übernimmt `offline_rules`. Pflichtfeld-Prüfung, Rückfragen und Quellen-Kennzeichnung
passieren danach in normalem, testbarem Code – nicht im LLM.
Juristischer Wortlaut wird hier NICHT erzeugt (das machen Vorlagen).
"""

import datetime as dt

from pydantic import BaseModel, Field

from src.schemas.ai import CaptureRequest, NoticeDraft, NoticeType, SourcedField
from src.services import llm, offline_rules

# Alle Felder, die das LLM füllen darf, mit deutscher Beschreibung für den Prompt.
# VORLÄUFIG (abgeleitet aus LetterDrafts.tsx) – mit Jue/Yannick abstimmen.
FIELD_DESCRIPTIONS: dict[str, str] = {
    "recipient": "Empfänger (Firma/Person, z. B. Auftraggeber, Planer, Nachunternehmer)",
    "location": "Ort auf der Baustelle (Bauteil, Achse, Geschoss, Bereich)",
    "start_date": "Datum des Ereignisses, ISO YYYY-MM-DD",
    "start_time": "Uhrzeit des Ereignisses, HH:MM",
    "cause": "Ursache / Grund (z. B. fehlende Pläne, Vorunternehmer nicht fertig)",
    "facts": "Sachverhalt: was ist passiert, sachlich in 1–3 Sätzen",
    "affected_work": "Betroffene Leistungen / Gewerke / Geräte / Personal",
    "consequences": "Folgen (Stillstand, Verzug, Mehraufwand) – nur wenn genannt",
    "cost_estimate": "Genannte Mehrkosten oder Mengen – nur wenn genannt",
    "deadline": "Genannte Frist, ISO YYYY-MM-DD",
}

# Pflichtfelder je Brieftyp. Fehlen sie, gibt es eine Rückfrage (und später blockiert /approve).
REQUIRED_FIELDS: dict[NoticeType, list[str]] = {
    "delay": ["facts", "cause", "start_date", "location"],
    "cost": ["facts", "cause", "location"],
    "defect": ["facts", "location", "deadline"],
    "concern": ["facts", "cause"],
}

QUESTIONS: dict[str, str] = {
    "recipient": "An wen soll das Schreiben gehen?",
    "location": "Wo genau auf der Baustelle (Bauteil/Achse/Geschoss)?",
    "start_date": "An welchem Datum ist das passiert?",
    "cause": "Was ist die Ursache bzw. wer hat sie zu vertreten?",
    "facts": "Was ist genau passiert?",
    "deadline": "Bis wann soll der Mangel beseitigt werden?",
}


class _LLMExtraction(BaseModel):
    """Antwortformat für das LLM. Alle Felder Pflicht im Schema; unbekannt = leerer String."""

    type: NoticeType = Field(description="delay=Behinderung, cost=Mehrkosten, defect=Mangel, concern=Bedenken")
    recipient: str
    location: str
    start_date: str
    start_time: str
    cause: str
    facts: str
    affected_work: str
    consequences: str
    cost_estimate: str
    deadline: str


def _system_prompt(ref_date: str, ref_time: str | None) -> str:
    field_lines = "\n".join(f"- {k}: {v}" for k, v in FIELD_DESCRIPTIONS.items())
    return f"""Du bist Assistent eines deutschen Bauleiters. Du erhältst ein kurzes Baustellen-Diktat
in beliebiger Sprache (oft Deutsch oder Polnisch) und extrahierst daraus Fakten für ein VOB/B-Schreiben.

Regeln:
- JEDER Feldwert muss vollständig DEUTSCH sein, sachlich und knapp. Übersetze nicht-deutsche
  Eingaben komplett, auch Fachbegriffe und Ortsangaben (z. B. "koparka" → "Bagger",
  "oś B" → "Achse B", "wykop" → "Baugrube"). Kein fremdsprachiges Wort im Ergebnis
  (Ausnahme: Eigennamen von Firmen/Personen).
- Unbekannt = leerer String "". Erfinde NIEMALS Namen, Orte, Daten, Beträge, Fristen oder Folgen.
  Fülle ein Feld nur, wenn die Information ausdrücklich im Diktat steht.
- Keine juristischen Formulierungen, keine Paragraphen – nur Fakten.
- Relative Angaben ("heute", "seit 10 Uhr", "gestern") beziehen sich auf Datum {ref_date}{f", Uhrzeit {ref_time}" if ref_time else ""}.
- type: delay = Behinderung/Stillstand/Verzug, cost = Mehrkosten/Zusatzleistung,
  defect = Mangel an fremder Leistung, concern = Bedenken gegen Vorgaben/Vorleistungen.

Felder:
{field_lines}"""


def _source(value: str, text: str, lang: str) -> str:
    """Quelle eines LLM-Werts: wörtlich im deutschen Diktat → "diktat", sonst "ki" (abgeleitet/übersetzt)."""
    if lang.lower().startswith("de") and value.lower() in text.lower():
        return "diktat"
    return "ki"


def _questions(notice_type: NoticeType, fields: dict[str, SourcedField]) -> list[str]:
    """Rückfragen für leere Pflichtfelder – deterministisch, nicht vom LLM."""
    return [
        QUESTIONS.get(name, f"Bitte '{name}' ergänzen.")
        for name in REQUIRED_FIELDS[notice_type]
        if not fields.get(name, SourcedField()).value.strip()
    ]


async def capture(req: CaptureRequest) -> NoticeDraft:
    """Erzeugt aus einem Diktat einen Brief-Entwurf (Typ + Felder + Rückfragen).

    Antwortet immer – bei LLM-Ausfall mit `mode="offline"` und Regel-Ergebnis.
    """
    ref_date = req.ref_date or dt.date.today().isoformat()
    result = await llm.complete_json(_system_prompt(ref_date, req.ref_time), req.text, _LLMExtraction)

    if result is None:
        notice_type, fields = offline_rules.extract_offline(req.text, ref_date, req.force_type)
        mode = "offline"
    else:
        notice_type = req.force_type or result.type
        fields = {
            name: SourcedField(value=value.strip(), src=_source(value.strip(), req.text, req.lang))
            for name, value in result.model_dump(exclude={"type"}).items()
            if value and value.strip()
        }
        mode = "ai"

    return NoticeDraft(type=notice_type, fields=fields, questions=_questions(notice_type, fields), mode=mode)

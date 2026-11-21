"""Prüfhinweise für einen Brief-Entwurf (Kern von POST /api/notices/{id}/review).

Das LLM liest den Entwurf und nennt fehlende oder unklare Angaben. Es schreibt
nichts um und gibt keine Rechtsberatung. Fallback ohne KI: einfache Regel-Checks.
"""

import re

from pydantic import BaseModel

from src.models import FormalNotice
from src.services import llm

SYSTEM_PROMPT = """Du prüfst den Entwurf eines VOB/B-Schreibens (Behinderungsanzeige, Mehrkostenanmeldung,
Mängelrüge oder Bedenkenanmeldung) eines deutschen Bauleiters auf Vollständigkeit.

Nenne höchstens 5 kurze, konkrete Hinweise auf Deutsch, z. B. fehlender Empfänger, fehlendes Datum,
fehlender Ort, fehlende Ursache, fehlende Frist, unklare Formulierung, Widersprüche.
Keine Rechtsberatung, keine Umformulierung des Textes, keine erfundenen Fakten.
Ist der Entwurf vollständig, gib eine leere Liste zurück."""


class _LLMReview(BaseModel):
    hints: list[str]


_DATE_RE = re.compile(r"\b\d{1,2}\.\d{1,2}\.(\d{2}|\d{4})\b|\b\d{4}-\d{2}-\d{2}\b")


def review_offline(notice: FormalNotice) -> list[str]:
    """Regel-Checks ohne KI: prüft nur Dinge, die sicher erkennbar sind."""
    hints: list[str] = []
    content = notice.body or ""
    if not (notice.recipient or "").strip():
        hints.append("Empfänger fehlt.")
    if not (notice.subject or "").strip():
        hints.append("Betreff fehlt.")
    if not _DATE_RE.search(content):
        hints.append("Im Text steht kein Datum – wann ist das Ereignis eingetreten?")
    if len(content.strip()) < 200:
        hints.append("Der Sachverhalt ist sehr kurz – bitte konkreter beschreiben.")
    if notice.type == "defect" and "frist" not in content.lower():
        hints.append("Bei einer Mängelrüge sollte eine Frist zur Beseitigung gesetzt werden.")
    return hints


async def review(notice: FormalNotice) -> tuple[list[str], str]:
    """Liefert (Hinweise, Modus). Modus "ai" = LLM, "offline" = Regel-Checks."""
    user = (
        f"Typ: {notice.type}\nEmpfänger: {notice.recipient or ''}\n"
        f"Betreff: {notice.subject or ''}\n\nText:\n{notice.body}"
    )
    result = await llm.complete_json(SYSTEM_PROMPT, user, _LLMReview)
    if result is None:
        return review_offline(notice), "offline"
    return [h.strip() for h in result.hints if h.strip()][:5], "ai"

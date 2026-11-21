"""Vertrag parsen: Sollstärke & Eckdaten aus dem Vertragstext lesen (Board: "Vertrag parsen: Sollstärke extrahieren").

Input ist der PDF-Text, den Yannicks Upload (`POST /contracts`) schon in `Contract.extracted_text` speichert.
Ergebnis ist nur ein VORSCHLAG mit Fundstelle je Feld – gespeichert wird erst, wenn der Nutzer ihn
per `PATCH /contracts/{id}` übernimmt (nichts ohne Freigabe).

KI-Regel "unbekannt = leer": Jeder KI-Wert braucht ein wörtliches Zitat aus dem Vertrag. Der Code prüft,
dass das Zitat wirklich im Text steht (und die Zahl im Zitat vorkommt) – sonst wird der Wert verworfen.
Ohne KI (Timeout/kein Key) greifen Regex-Regeln.
"""

import re
from typing import Literal

from pydantic import BaseModel

from src.models import Contract
from src.schemas.contract_parse import ContractParseResponse, ParsedField
from src.services import llm

MAX_CHARS = 12_000  # ~3.500 Tokens – passt ins Groq-Limit (8K Tokens/Minute)
KEYWORDS = ("sollstärke", "mindestbesetzung", "mindestpersonal", "personalstärke", "arbeitskräfte",
            "ausführungsfrist", "baubeginn", "fertigstellung", "vob", "vertragsstrafe", "behinderung")

_WORKFORCE_RES = [
    re.compile(r"(?:Sollstärke|Mindestbesetzung|Mindestpersonal|Personalstärke|Kolonnenstärke)[^\d\n]{0,60}?(\d{1,3})",
               re.IGNORECASE),
    re.compile(r"(?:mindestens|mind\.)\s*(\d{1,3})\s*(?:gewerbliche\s+)?(?:Arbeitskräfte|Arbeiter|Mann|Personen|Monteure)",
               re.IGNORECASE),
]
_DATE = r"(\d{1,2}\.\d{1,2}\.\d{4})"
_START_RE = re.compile(rf"(?:Ausführungsbeginn|Baubeginn|Beginn der (?:Ausführung|Arbeiten))\D{{0,40}}?{_DATE}", re.IGNORECASE)
_END_RE = re.compile(rf"(?:Fertigstellung(?:stermin)?|Ausführungsende|Ende der (?:Ausführung|Arbeiten))\D{{0,40}}?{_DATE}",
                     re.IGNORECASE)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def excerpt(text: str) -> str:
    """Langer Vertrag → Anfang + Absätze mit Schlüsselwörtern (damit die Sollstärke auch auf S. 12 gefunden wird)."""
    if len(text) <= MAX_CHARS:
        return text
    head = text[: MAX_CHARS // 2]
    parts, budget = [], MAX_CHARS // 2
    for m in re.finditer("|".join(KEYWORDS), text, re.IGNORECASE):
        start = max(0, m.start() - 300)
        if start < len(head):
            continue
        chunk = text[start: m.start() + 300]
        if budget - len(chunk) < 0:
            break
        parts.append(chunk)
        budget -= len(chunk)
    return head + "\n[…]\n" + "\n[…]\n".join(parts)


def _line(text: str, pos: int) -> str:
    """Fundstelle = die Zeile rund um den Treffer (max. 200 Zeichen)."""
    start = text.rfind("\n", 0, pos) + 1
    end = text.find("\n", pos)
    return text[start: end if end != -1 else len(text)].strip()[:200]


def offline_parse(text: str) -> dict[str, ParsedField]:
    """Regeln ohne KI: Sollstärke, Ausführungsbeginn, Fertigstellung."""
    fields: dict[str, ParsedField] = {}
    for rx in _WORKFORCE_RES:
        m = rx.search(text)
        if m and 0 < int(m.group(1)) <= 500:
            fields["planned_workforce"] = ParsedField(value=int(m.group(1)), src=_line(text, m.start()))
            break
    for key, rx in (("execution_start", _START_RE), ("execution_end", _END_RE)):
        m = rx.search(text)
        if m:
            fields[key] = ParsedField(value=m.group(1), src=_line(text, m.start()))
    return fields


class _LLMContract(BaseModel):
    planned_workforce: str
    planned_workforce_quote: str
    contractor_name: str
    contractor_name_quote: str
    trade: str
    trade_quote: str
    execution_start: str
    execution_start_quote: str
    execution_end: str
    execution_end_quote: str
    vob_special: str
    vob_special_quote: str


PARSE_PROMPT = """Du liest einen deutschen Bauvertrag (Nachunternehmervertrag) und extrahierst Eckdaten.
Für JEDES Feld: Wert + wörtliches Zitat (quote) genau so, wie es im Vertrag steht (max. 200 Zeichen).
Unbekannt = Wert UND Zitat leer lassen. NIE etwas erfinden oder ableiten.
- planned_workforce: vertraglich geschuldete Sollstärke / Mindestbesetzung als Zahl (z. B. "6").
- contractor_name: Firma des Auftragnehmers / Nachunternehmers.
- trade: Gewerk (z. B. "Erdbau", "Rohbau", "Elektro").
- execution_start / execution_end: Ausführungsbeginn / Fertigstellung als TT.MM.JJJJ.
- vob_special: vertragliche Besonderheiten zu VOB/B (z. B. Fristen für Behinderungsanzeigen,
  Vertragsstrafe), knapp in einem Satz."""


def _verified(text_norm: str, value: str, quote: str, number: bool = False) -> ParsedField | None:
    """Nur übernehmen, wenn das Zitat wörtlich im Vertrag steht (und die Zahl im Zitat vorkommt)."""
    value, quote = (value or "").strip(), (quote or "").strip()
    if not value or not quote or _norm(quote) not in text_norm:
        return None
    if number:
        digits = re.sub(r"\D", "", value)
        if not digits or not re.search(rf"(?<!\d){digits}(?!\d)", quote) or not 0 < int(digits) <= 500:
            return None
        return ParsedField(value=int(digits), src=quote)
    return ParsedField(value=value, src=quote)


async def parse_contract(contract: Contract) -> ContractParseResponse:
    """Vertragstext → Vorschlag {Feld: {value, src}} + Modus. Speichert nichts."""
    text = contract.extracted_text or ""
    part = excerpt(text)
    result = await llm.complete_json(PARSE_PROMPT, part, _LLMContract, max_tokens=700)
    mode: Literal["ai", "offline"] = "ai"
    if result is None:
        fields, mode = offline_parse(text), "offline"
    else:
        text_norm = _norm(text)
        r = result.model_dump()
        fields = {}
        for key in ("planned_workforce", "contractor_name", "trade", "execution_start", "execution_end", "vob_special"):
            f = _verified(text_norm, r[key], r[f"{key}_quote"], number=key == "planned_workforce")
            if f is not None:
                fields[key] = f
        # Sicherheitsnetz: Findet die KI keine (belegbare) Sollstärke, versuchen es die Regeln.
        if "planned_workforce" not in fields:
            fallback = offline_parse(text).get("planned_workforce")
            if fallback:
                fields["planned_workforce"] = fallback

    # Vorschlag passend zu Yannicks PATCH /contracts/{id} (nur Felder, die es dort gibt).
    patch: dict = {}
    if "planned_workforce" in fields:
        patch["planned_workforce"] = fields["planned_workforce"].value
    if "contractor_name" in fields and not contract.contractor_name:
        patch["contractor_name"] = fields["contractor_name"].value
    if "trade" in fields and not contract.trade:
        patch["trade"] = fields["trade"].value
    if "vob_special" in fields and not contract.vob_notes:
        patch["vob_notes"] = fields["vob_special"].value
    return ContractParseResponse(contract_id=contract.id, mode=mode, fields=fields, suggested_patch=patch,
                                 current_planned_workforce=contract.planned_workforce)

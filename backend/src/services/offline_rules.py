"""Regelbasierter Fallback ohne KI: Diktat → Brieftyp + Grundfelder.

Greift, wenn das LLM nicht erreichbar ist (kein Key, Timeout, 429, Fehler).
Bewusst einfach: Schlüsselwörter (Deutsch + Polnisch) bestimmen den Typ, der
Rohtext wird unverändert als Sachverhalt übernommen. Der Bauleiter ergänzt den Rest.
"""

import re

from src.schemas.ai import NoticeType, SourcedField

# Reihenfolge = Priorität bei mehreren Treffern. Kleinbuchstaben, Teilwort-Treffer.
KEYWORDS: dict[NoticeType, list[str]] = {
    "defect": ["mangel", "mängel", "riss", "undicht", "fehlerhaft", "schaden", "usterk", "pęknię", "wad"],
    "concern": ["bedenken", "bedenklich", "ungeeignet", "nicht geeignet", "zastrzeż", "wątpliwoś"],
    "cost": ["mehrkosten", "nachtrag", "zusätzlich", "zusatzleistung", "teurer", "dodatkow", "koszt"],
    "delay": ["behinder", "steht", "stillstand", "warten", "fehlt", "fehlen", "verzög", "stoi", "brak", "czeka", "opóźni"],
}

# "10 Uhr", "10:30", "10.30", "o 10:00"
_TIME_RE = re.compile(r"\b(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr|h)\b|\b(\d{1,2})[:.](\d{2})\b", re.IGNORECASE)


def classify(text: str) -> NoticeType:
    """Bestimmt den Brieftyp per Schlüsselwort. Kein Treffer → Behinderung (häufigster Fall)."""
    lower = text.lower()
    for notice_type, words in KEYWORDS.items():
        if any(w in lower for w in words):
            return notice_type
    return "delay"


def extract_time(text: str) -> str:
    """Findet die erste Uhrzeit im Text und gibt sie als HH:MM zurück (sonst leer)."""
    m = _TIME_RE.search(text)
    if not m:
        return ""
    hour = m.group(1) or m.group(3)
    minute = m.group(2) or m.group(4) or "00"
    return f"{int(hour):02d}:{minute}"


def extract_offline(text: str, ref_date: str, force_type: NoticeType | None = None) -> tuple[NoticeType, dict[str, SourcedField]]:
    """Fallback-Extraktion.

    Input:  Diktat, Bezugsdatum (ISO), optional erzwungener Typ.
    Output: (Brieftyp, Felder). Nur sicher Ableitbares wird gefüllt – unbekannt bleibt leer.
    """
    notice_type = force_type or classify(text)
    fields = {
        "facts": SourcedField(value=text.strip(), src="diktat"),
        # Ohne KI kennen wir nur das Bezugsdatum, nicht das echte Ereignisdatum → Quelle "regel".
        "start_date": SourcedField(value=ref_date, src="regel"),
    }
    time_value = extract_time(text)
    if time_value:
        fields["start_time"] = SourcedField(value=time_value, src="diktat")
    return notice_type, fields

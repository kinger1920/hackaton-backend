"""Request-/Response-Schemas der KI-Endpunkte (Contract: /api/capture, /api/transcribe,
/api/notices/{id}/review).

Pydantic prüft eingehende Requests automatisch: fehlt ein Pflichtfeld oder hat es
den falschen Typ, antwortet FastAPI mit 422, bevor unser Code überhaupt läuft.

VORLÄUFIG: Feldnamen der Briefe sind aus dem Frontend (`LetterDrafts.tsx`) abgeleitet,
weil der Prototyp mit `TYPES` nicht im Repo liegt → mit Jue/Yannick bestätigen.
"""

from typing import Literal

from pydantic import BaseModel, Field

# Brieftypen wie im Frontend: Behinderungsanzeige, Mehrkostenanmeldung, Mängelrüge, Bedenkenanmeldung.
NoticeType = Literal["delay", "cost", "defect", "concern"]

# Herkunft eines Feldwerts ("jedes Feld zeigt seine Quelle"):
#   diktat = wörtlich aus der Eingabe · ki = von der KI abgeleitet/übersetzt
#   regel  = Offline-Regel/Default    · nutzer = vom Bauleiter bearbeitet
FieldSource = Literal["diktat", "ki", "regel", "nutzer"]


class SourcedField(BaseModel):
    """Ein Feldwert plus seine Quelle (Contract-Modell `Field{value, src}`)."""

    value: str = ""
    src: FieldSource = "ki"


class CaptureRequest(BaseModel):
    """Body für POST /api/capture."""

    text: str = Field(min_length=1, description="Diktat oder Texteingabe, beliebige Sprache")
    lang: str = Field(default="de", description="Sprache der Eingabe, z. B. de, pl, en")
    ref_date: str | None = Field(default=None, description="Bezugsdatum ISO YYYY-MM-DD (Default: heute)")
    ref_time: str | None = Field(default=None, description="Bezugszeit HH:MM")
    force_type: NoticeType | None = Field(default=None, description="Brieftyp erzwingen statt erkennen")
    project_id: int | None = Field(
        default=None, description="Projekt für den Tagebucheintrag (Default: erstes Projekt der DB)"
    )


class NoticeDraft(BaseModel):
    """Antwort von POST /api/capture: erkannter Brieftyp + gefüllte Felder + Rückfragen."""

    type: NoticeType
    fields: dict[str, SourcedField]
    questions: list[str] = Field(default_factory=list, description="Rückfragen zu fehlenden Pflichtangaben")
    mode: Literal["ai", "offline"] = Field(description="ai = Claude, offline = Regel-Fallback")
    site_note_id: int | None = Field(default=None, description="ID des neuen Tagebucheintrags (SiteNote)")
    notice_id: int | None = Field(default=None, description="ID des gespeicherten Brief-Entwurfs (FormalNotice)")


class TranscribeResponse(BaseModel):
    """Antwort von POST /api/transcribe."""

    text: str
    lang: str


class ReviewResponse(BaseModel):
    """Antwort von POST /api/notices/{id}/review: Prüfhinweise zum Entwurf."""

    hints: list[str]
    mode: Literal["ai", "offline"]

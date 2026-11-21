"""Request-/Response-Schemas für die Brief-Endpunkte (Contract: GET/PATCH /api/notices,
POST /api/notices/{id}/approve).

`NoticeOut` = gespeicherter FormalNotice (API_CONTRACT.md) + Felder mit Quelle + Freigabe-Audit.
"""

from datetime import datetime

from pydantic import BaseModel, Field

from src.schemas.ai import NoticeType, SourcedField


class NoticeOut(BaseModel):
    """Ein Brief-Entwurf, wie das Frontend ihn anzeigt."""

    id: int
    project_id: int
    type: NoticeType
    title: str | None
    recipient: str | None
    subject: str | None
    body: str
    legal_disclaimer: str
    source_references: str | None
    status: str = Field(description='"Entwurf" | "Freigegeben" | "Exportiert"')
    created_at: datetime
    updated_at: datetime

    fields: dict[str, SourcedField] = Field(description="Feldwerte mit Quelle (diktat/ki/regel/nutzer)")
    missing_fields: list[str] = Field(description="Pflichtangaben, die vor der Freigabe fehlen")
    questions: list[str] = Field(description="Rückfragen zu den fehlenden Pflichtangaben")
    approved_by: str | None = None
    approved_at: datetime | None = None


class NoticePatch(BaseModel):
    """Body für PATCH /api/notices/{id}. Alle Angaben optional, nur Mitgeschicktes ändert sich.

    - `fields`: Feldwerte setzen (Quelle wird "nutzer"); leerer String löscht ein Feld.
      Danach werden Betreff und Brieftext aus der Vorlage neu erzeugt.
    - `subject` / `body`: manuell bearbeiteter Text – überschreibt die Vorlage.
    """

    fields: dict[str, str] | None = None
    recipient: str | None = None
    subject: str | None = None
    body: str | None = None


class ApproveConflict(BaseModel):
    """Inhalt von `detail` bei 409 auf /approve (fehlende Pflichtangaben)."""

    missing_fields: list[str]
    questions: list[str]

from datetime import date, datetime, timezone
from typing import Optional

from pydantic import field_validator, model_validator
from sqlmodel import Field, SQLModel


def _blank_to_none(value):
    """Formular schickt leere Felder als "" – für Datum/Zahl heißt das "nicht gesetzt" (sonst 422)."""
    return None if isinstance(value, str) and not value.strip() else value


class _MasterData(SQLModel):
    """Projekt-Stammdaten (Board: Bauvolumen, Kosten, Standort, Bauform) – Feldnamen wie im Frontend-Formular."""

    construction_volume_eur: Optional[float] = Field(default=None, ge=0)  # Bauvolumen in €
    budget_eur: Optional[float] = Field(default=None, ge=0)  # Kosten / Budget in €
    gross_floor_area_m2: Optional[float] = Field(default=None, ge=0)  # Bruttogrundfläche (BGF)
    gross_volume_m3: Optional[float] = Field(default=None, ge=0)  # Bruttorauminhalt (BRI)
    construction_type: Optional[str] = None  # Bauform, z. B. "Massivbau", "Stahlbeton-Skelettbau"
    start_date: Optional[date] = None  # Bauzeit
    end_date: Optional[date] = None
    contract_type: Optional[str] = None  # z. B. "Einheitspreisvertrag"
    vob_b_agreed: Optional[bool] = None
    vob_notes: Optional[str] = None  # projektbezogene VOB-Regelungen

    @field_validator("construction_volume_eur", "budget_eur", "gross_floor_area_m2", "gross_volume_m3",
                     "start_date", "end_date", mode="before")
    @classmethod
    def _blank(cls, value):
        return _blank_to_none(value)

    @model_validator(mode="after")
    def _dates_in_order(self):
        # 422 statt unsinniger Bauzeit (Ende vor Beginn).
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date liegt vor start_date")
        return self


class ProjectBase(_MasterData):
    name: str = Field(index=True)
    number: Optional[str] = Field(default=None, index=True)
    client: Optional[str] = None
    location: Optional[str] = None
    phase: Optional[str] = Field(default="Rohbau")
    status: str = Field(default="Aktiv")  # Aktiv, In Planung, Abgeschlossen
    description: Optional[str] = None


class Project(ProjectBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(_MasterData):
    name: Optional[str] = None
    number: Optional[str] = None
    client: Optional[str] = None
    location: Optional[str] = None
    phase: Optional[str] = None
    status: Optional[str] = None
    description: Optional[str] = None


class ProjectRead(ProjectBase):
    id: int
    created_at: datetime
    updated_at: datetime

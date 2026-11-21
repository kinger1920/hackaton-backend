from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


class ContractBase(SQLModel):
    project_id: int = Field(foreign_key="project.id", index=True)
    title: str
    contractor_name: Optional[str] = Field(default=None, index=True)  # Firma / Vertragspartner
    trade: Optional[str] = Field(default=None, index=True)  # Gewerk, z. B. "Rohbau", "Maler", "TGA"
    planned_workforce: Optional[int] = None  # Vertragliche Sollstärke (Anzahl Arbeiter)
    vob_notes: Optional[str] = None  # Firmenspezifische VOB-Regelungen / Vertragsbesonderheiten
    file_name: Optional[str] = None
    file_path: Optional[str] = None
    extracted_text: Optional[str] = None  # Extrahierter PDF-Volltext für KI-Abgleich
    is_active: Optional[bool] = Field(default=True)  # Aktiver vs. inaktiver Vertrag


class Contract(ContractBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ContractCreate(ContractBase):
    pass


class ContractUpdate(SQLModel):
    title: Optional[str] = None
    contractor_name: Optional[str] = None
    trade: Optional[str] = None
    planned_workforce: Optional[int] = None
    vob_notes: Optional[str] = None
    is_active: Optional[bool] = None


class ContractRead(ContractBase):
    id: int
    uploaded_at: datetime

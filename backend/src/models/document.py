from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


class ProjectDocument(SQLModel, table=True):
    """Projektdokumente für Synthese & Verlauf (Besprechungsprotokolle, E-Mails, Tagebucheinträge)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    doc_key: Optional[str] = Field(default=None, index=True)
    doc_type: str = Field(default="minutes", index=True)  # "diary" | "minutes" | "emails"
    title: str
    doc_date: str  # TT.MM.JJJJ oder ISO
    author: str
    content: str
    weather: Optional[str] = None
    workforce_count: Optional[int] = None
    trades_json: Optional[str] = None
    hindrance: Optional[str] = None
    summary_json: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class UserProfile(SQLModel, table=True):
    """Bauleiter-Profil (Name, Firma, Rolle, Kontaktdaten, Berechtigungen)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    full_name: str = Field(default="Max Mustermann")
    email: str = Field(default="m.mustermann@bau-ag.de")
    phone: str = Field(default="+49 170 1234567")
    company: str = Field(default="Baupartner AG & Co. KG")
    role: str = Field(default="Bauleiter")
    office_location: str = Field(default="Niederlassung Berlin-Brandenburg")
    workplace_type: str = Field(default="Baustellencontainer vor Ort")
    permissions_json: str = Field(
        default='{"dailyReports": true, "vobLetters": true, "defectNotices": true, "claims": false}'
    )
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

"""Mängel (Mängelmanagement wie in gängigen Baustellen-Apps): ein Mangel mit Ort, Firma, Frist und Status.

Status-Ablauf: offen → in_bearbeitung → behoben → abgenommen (zurück auf offen jederzeit möglich).
Verweise auf Foto, Mängelrüge und Vorgang sind bewusst einfache IDs ohne Fremdschlüssel: Löschen von
Fotos/Briefen/Vorgängen scheitert so nie an einem Mangel; fehlt das Ziel, zeigt die Oberfläche den Link nicht.
"""

from datetime import date, datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel

DEFECT_STATUSES = ("offen", "in_bearbeitung", "behoben", "abgenommen")
DEFECT_PRIORITIES = ("niedrig", "mittel", "hoch")


class Defect(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    title: str
    description: Optional[str] = None
    location: Optional[str] = None  # Freitext, z. B. "Haus B · Gründung, Sockel Feld 3"
    house: Optional[str] = None  # "Haus B" – aus location erkannt, falls nicht gesetzt
    level: Optional[str] = None  # "Gründung", "UG", "EG", "1.OG", …, "Dach"
    trade: Optional[str] = None
    company: Optional[str] = Field(default=None, index=True)  # verantwortliche Firma
    priority: str = Field(default="mittel")
    status: str = Field(default="offen", index=True)
    found_date: date = Field(default_factory=date.today, index=True)  # festgestellt am
    deadline: Optional[date] = None  # Frist zur Beseitigung
    resolved_date: Optional[date] = None  # gemeldet behoben
    accepted_date: Optional[date] = None  # abgenommen durch Bauleitung
    photo_id: Optional[int] = None
    notice_id: Optional[int] = None  # verknüpfte Mängelrüge (FormalNotice)
    task_id: Optional[int] = None
    source: str = Field(default="manuell")  # manuell | foto | brief | begehung | demo
    reported_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

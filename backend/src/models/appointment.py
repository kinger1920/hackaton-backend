from datetime import date as dt_date, datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


class Appointment(SQLModel, table=True):
    """Manuell angelegter Termin / Frist im Baustellenkalender."""

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    title: str
    date: dt_date = Field(index=True)
    time: Optional[str] = None
    category: str = Field(default="meeting")  # deadline, milestone, inspection, meeting, delivery
    trade: Optional[str] = None
    description: Optional[str] = None
    vob_reference: Optional[str] = None
    is_urgent: bool = Field(default=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

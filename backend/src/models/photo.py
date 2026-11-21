from datetime import date as dt_date, datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


class SitePhoto(SQLModel, table=True):
    """Baustellenfoto mit Zuordnung zu Projekt & Kalendertag sowie KI-/Regel-Analyse."""

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    report_date: dt_date = Field(index=True)
    file_name: str
    file_path: str
    mime_type: str = Field(default="image/jpeg")
    caption: Optional[str] = None
    diary_text: Optional[str] = None
    issues_json: Optional[str] = None  # JSON-Liste: ["Mangel / Hinweis 1", ...]
    source_mode: str = Field(default="offline")  # "ai" | "offline"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

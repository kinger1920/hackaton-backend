from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


class SiteNoteBase(SQLModel):
    project_id: int = Field(foreign_key="project.id", index=True)
    content: str
    category: Optional[str] = Field(default="general")  # delay, incident, weather, progress, defect, general
    audio_file_path: Optional[str] = None
    author: Optional[str] = "Bauleiter"
    status: str = Field(default="raw")  # raw, processed, incorporated


class SiteNote(SiteNoteBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SiteNoteCreate(SiteNoteBase):
    pass


class SiteNoteRead(SiteNoteBase):
    id: int
    created_at: datetime

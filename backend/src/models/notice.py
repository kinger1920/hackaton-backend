from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


class FormalNoticeBase(SQLModel):
    project_id: int = Field(foreign_key="project.id", index=True)
    type: str = Field(index=True)  # delay, cost, defect, concern
    title: Optional[str] = None
    recipient: Optional[str] = None
    subject: Optional[str] = None
    body: str
    legal_disclaimer: str = Field(default="Entwurf zur Prüfung durch die Bauleitung - Keine Rechtsberatung")
    source_references: Optional[str] = None  # JSON string with IDs of cited notes/reports/tasks
    status: str = Field(default="Entwurf")  # Entwurf, Freigegeben, Exportiert


class FormalNotice(FormalNoticeBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class FormalNoticeCreate(FormalNoticeBase):
    pass


class FormalNoticeRead(FormalNoticeBase):
    id: int
    created_at: datetime
    updated_at: datetime

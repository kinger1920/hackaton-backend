from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class FormalNoticeBase(SQLModel):
    project_id: int = Field(foreign_key="project.id", index=True)
    notice_type: str = Field(index=True)  # Behinderungsanzeige, Mehrkostenanmeldung, Bedenkenanmeldung, Mängelrüge
    title: str
    recipient: Optional[str] = None
    subject: Optional[str] = None
    content_markdown: str
    legal_disclaimer: str = Field(default="Entwurf zur Prüfung durch die Bauleitung - Keine Rechtsberatung")
    source_references: Optional[str] = None  # JSON string with IDs of cited notes/reports/tasks
    status: str = Field(default="draft")  # draft, approved, exported


class FormalNotice(FormalNoticeBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class FormalNoticeCreate(FormalNoticeBase):
    pass


class FormalNoticeRead(FormalNoticeBase):
    id: int
    created_at: datetime
    updated_at: datetime

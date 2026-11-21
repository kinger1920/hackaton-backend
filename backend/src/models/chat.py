from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


class ChatSessionBase(SQLModel):
    project_id: int = Field(foreign_key="project.id", index=True)
    title: str = Field(default="Neuer Chat")


class ChatSession(ChatSessionBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ChatSessionCreate(ChatSessionBase):
    pass


class ChatSessionRead(ChatSessionBase):
    id: int
    created_at: datetime


class ChatMessageBase(SQLModel):
    session_id: int = Field(foreign_key="chatsession.id", index=True)
    role: str  # "user", "assistant", "system"
    content: str
    metadata_json: Optional[str] = None  # JSON string for citations, suggested action triggers, tool outputs


class ChatMessage(ChatMessageBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ChatMessageCreate(ChatMessageBase):
    pass


class ChatMessageRead(ChatMessageBase):
    id: int
    created_at: datetime

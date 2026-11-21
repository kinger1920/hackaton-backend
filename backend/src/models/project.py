from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


class ProjectBase(SQLModel):
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


class ProjectUpdate(SQLModel):
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

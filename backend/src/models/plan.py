from datetime import datetime, date, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


class ConstructionPlanBase(SQLModel):
    project_id: int = Field(foreign_key="project.id", index=True)
    title: str
    version: Optional[str] = "1.0"
    file_path: Optional[str] = None
    file_name: Optional[str] = None
    raw_data: Optional[str] = None  # JSON string representing full Gantt/WBS hierarchy or parsed schedule


class ConstructionPlan(ConstructionPlanBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ConstructionPlanCreate(ConstructionPlanBase):
    pass


class ConstructionPlanRead(ConstructionPlanBase):
    id: int
    uploaded_at: datetime


class PlanTaskBase(SQLModel):
    plan_id: int = Field(foreign_key="constructionplan.id", index=True)
    task_code: Optional[str] = None
    title: str
    trade: Optional[str] = None  # e.g., "Rohbau", "Erdarbeiten", "Elektro"
    planned_start: Optional[date] = None
    planned_end: Optional[date] = None
    actual_start: Optional[date] = None
    actual_end: Optional[date] = None
    status: str = Field(default="pending")  # pending, in_progress, delayed, completed
    notes: Optional[str] = None


class PlanTask(PlanTaskBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)


class PlanTaskCreate(PlanTaskBase):
    pass


class PlanTaskRead(PlanTaskBase):
    id: int

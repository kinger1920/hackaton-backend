"""API-Schemas für Vorgänge des Bauzeitenplans: Import (CSV/PDF), Bulk-Übernahme und Einzel-CRUD."""

import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class ImportedTask(BaseModel):
    """Ein gelesener Vorgang (Vorschau oder zu übernehmen). `source` = Fundstelle (CSV-Zeile / PDF-Zitat)."""

    code: str | None = None
    title: str = Field(min_length=1)
    trade: str | None = None
    start: dt.date
    end: dt.date
    source: str | None = None

    @model_validator(mode="after")
    def _order(self):
        if self.end < self.start:
            raise ValueError("end liegt vor start")
        return self


class RowError(BaseModel):
    row: int
    error: str


class ImportResult(BaseModel):
    """Antwort von POST /api/plans/{id}/import. dry_run=True → nichts gespeichert (created/updated = 0)."""

    planId: int
    mode: Literal["csv", "ai", "offline"]
    dryRun: bool
    tasks: list[ImportedTask]
    errors: list[RowError]
    warnings: list[str]
    created: int
    updated: int


class BulkRequest(BaseModel):
    tasks: list[ImportedTask] = Field(min_length=1)


class TaskIn(BaseModel):
    task_code: str | None = None
    title: str = Field(min_length=1)
    trade: str | None = None
    planned_start: dt.date
    planned_end: dt.date
    status: str = "pending"

    @model_validator(mode="after")
    def _order(self):
        if self.planned_end < self.planned_start:
            raise ValueError("planned_end liegt vor planned_start")
        return self


class TaskPatch(BaseModel):
    task_code: str | None = None
    title: str | None = None
    trade: str | None = None
    planned_start: dt.date | None = None
    planned_end: dt.date | None = None
    actual_start: dt.date | None = None
    actual_end: dt.date | None = None
    status: str | None = None

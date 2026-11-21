"""Schemas für das Mängelmanagement (/api/defects)."""

import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field, field_validator

DefectStatus = Literal["offen", "in_bearbeitung", "behoben", "abgenommen"]
DefectPriority = Literal["niedrig", "mittel", "hoch"]


def _blank(v):
    return None if isinstance(v, str) and not v.strip() else v


class DefectIn(BaseModel):
    project_id: int
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    location: str | None = None
    house: str | None = None
    level: str | None = None
    trade: str | None = None
    company: str | None = None
    priority: DefectPriority = "mittel"
    status: DefectStatus = "offen"
    found_date: dt.date | None = None
    deadline: dt.date | None = None
    photo_id: int | None = None
    notice_id: int | None = None
    task_id: int | None = None
    source: str = "manuell"
    reported_by: str | None = None

    _blank_fields = field_validator("description", "location", "house", "level", "trade", "company",
                                    "reported_by", "deadline", "found_date", mode="before")(_blank)


class DefectPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    location: str | None = None
    house: str | None = None
    level: str | None = None
    trade: str | None = None
    company: str | None = None
    priority: DefectPriority | None = None
    status: DefectStatus | None = None
    found_date: dt.date | None = None
    deadline: dt.date | None = None
    resolved_date: dt.date | None = None
    accepted_date: dt.date | None = None
    photo_id: int | None = None
    notice_id: int | None = None
    task_id: int | None = None

    _blank_fields = field_validator("description", "location", "house", "level", "trade", "company",
                                    "deadline", "found_date", "resolved_date", "accepted_date", mode="before")(_blank)


class DefectOut(BaseModel):
    id: int
    project_id: int
    title: str
    description: str | None
    location: str | None
    house: str | None
    level: str | None
    trade: str | None
    company: str | None
    priority: DefectPriority
    status: DefectStatus
    found_date: dt.date
    deadline: dt.date | None
    resolved_date: dt.date | None
    accepted_date: dt.date | None
    photo_id: int | None
    notice_id: int | None
    task_id: int | None
    source: str
    reported_by: str | None
    is_overdue: bool  # Frist vorbei und weder behoben noch abgenommen
    days_overdue: int  # Kalendertage über der Frist (0 wenn nicht überfällig)
    created_at: dt.datetime
    updated_at: dt.datetime


class DefectCompanyCount(BaseModel):
    company: str
    open: int
    overdue: int


class DefectSummary(BaseModel):
    total: int
    by_status: dict[str, int]
    open: int  # offen + in_bearbeitung
    overdue: int
    by_company: list[DefectCompanyCount]

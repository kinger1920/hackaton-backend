"""API-Schemas für GET /api/schedule (Tagesaufgaben + Termine) sowie CRUD für manuelle Termine.

`SiteAppointment` folgt 1:1 dem Frontend-Format (frontend/src/termin/Termin.tsx).
Manuelle Termine (`source="manual"`, `editable=True`) stammen aus der Tabelle `appointment`,
automatische Termine (`source="plan" | "workforce"`, `editable=False`) werden live berechnet.
"""

import datetime as dt
from typing import Literal

from pydantic import BaseModel, field_validator

AppointmentCategory = Literal["deadline", "milestone", "inspection", "meeting", "delivery"]
AppointmentSource = Literal["manual", "plan", "workforce"]


def _clean_opt(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


class DayTask(BaseModel):
    """Ein Vorgang, der laut Plan an diesem Tag läuft."""

    taskId: int
    code: str
    title: str
    trade: str | None
    company: str | None  # nur wenn eindeutig über den Vertrag zuordenbar
    plannedWorkforce: int | None  # Sollstärke laut Vertrag
    planPercent: int  # Soll-Fortschritt am Ende dieses Tages
    actualPercent: int  # letzter gemeldeter Ist-Stand (bis heute)
    status: Literal["delayed", "warning", "ontrack"]
    isStart: bool
    isEnd: bool
    isOverdue: bool = False  # Plan-Ende überschritten, aber noch nicht fertig → Restarbeiten
    source: str


class ScheduleDay(BaseModel):
    date: dt.date
    tasks: list[DayTask]


class SiteAppointment(BaseModel):
    id: str
    projectId: int
    title: str
    date: dt.date
    time: str | None = None
    category: AppointmentCategory
    trade: str | None = None
    description: str | None = None
    vobReference: str | None = None
    isUrgent: bool = False
    source: AppointmentSource = "plan"
    sourceLabel: str | None = None
    editable: bool = False


class AppointmentCreate(BaseModel):
    projectId: int | None = None
    title: str
    date: dt.date
    time: str | None = None
    category: AppointmentCategory = "meeting"
    trade: str | None = None
    description: str | None = None
    vobReference: str | None = None
    isUrgent: bool = False

    @field_validator("title")
    @classmethod
    def _non_empty_title(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Bezeichnung darf nicht leer sein")
        return cleaned

    @field_validator("time", "trade", "description", "vobReference")
    @classmethod
    def _clean_optional_fields(cls, v: str | None) -> str | None:
        return _clean_opt(v)


class AppointmentUpdate(BaseModel):
    title: str | None = None
    date: dt.date | None = None
    time: str | None = None
    category: AppointmentCategory | None = None
    trade: str | None = None
    description: str | None = None
    vobReference: str | None = None
    isUrgent: bool | None = None

    @field_validator("title")
    @classmethod
    def _non_empty_title(cls, v: str | None) -> str | None:
        if v is None:
            return None
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Bezeichnung darf nicht leer sein")
        return cleaned

    @field_validator("time", "trade", "description", "vobReference")
    @classmethod
    def _clean_optional_fields(cls, v: str | None) -> str | None:
        return _clean_opt(v)


class Schedule(BaseModel):
    """Antwort von GET /api/schedule."""

    projectId: int
    dateFrom: dt.date
    dateTo: dt.date
    refDate: dt.date
    days: list[ScheduleDay]
    appointments: list[SiteAppointment]

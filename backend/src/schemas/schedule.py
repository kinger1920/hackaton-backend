"""API-Schemas für GET /api/schedule (Tagesaufgaben + kommende Termine aus dem Bauzeitenplan).

`appointments` folgt 1:1 Jues `SiteAppointment` (frontend/src/termin/Termin.tsx), damit die
Termin-Seite ihre Mock-Daten direkt ersetzen kann.
"""

import datetime as dt
from typing import Literal

from pydantic import BaseModel

AppointmentCategory = Literal["deadline", "milestone", "inspection", "meeting", "delivery"]


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


class Schedule(BaseModel):
    """Antwort von GET /api/schedule."""

    projectId: int
    dateFrom: dt.date
    dateTo: dt.date
    refDate: dt.date
    days: list[ScheduleDay]
    appointments: list[SiteAppointment]

"""Schemas für die Gebäudeansicht im Baufortschritt (GET /api/progress/building)."""

import datetime as dt
from typing import Literal

from pydantic import BaseModel

EventKind = Literal["defect", "hindrance", "incident", "photo"]


class ProgressPoint(BaseModel):
    date: dt.date
    percent: int


class BuildingTask(BaseModel):
    id: int
    planId: int
    code: str | None
    title: str
    trade: str
    company: str
    location: str | None
    house: str | None  # "Haus B" – None = keinem Gebäude zugeordnet (z. B. Baustelleneinrichtung)
    level: str | None  # "Gründung", "UG", "EG", "1.OG", …, "Dach"
    plannedStart: dt.date | None
    plannedEnd: dt.date | None
    durationDays: int  # Werktage (wie /api/analysis)
    history: list[ProgressPoint]  # gemeldete Stände aus Tagesberichten, chronologisch
    actualEnd: dt.date | None


class BuildingEvent(BaseModel):
    """Mangel, Behinderung, Vorkommnis oder Foto-Befund mit Ort und Datum."""

    id: str
    kind: EventKind
    date: dt.date
    title: str
    detail: str
    house: str | None
    level: str | None
    taskIds: list[int]  # betroffene Vorgänge (wenn bekannt)
    source: str  # Quellen-Label, z. B. "Schreiben #3 Mängelrüge", "Tagesbericht 17.11.2026"
    noticeId: int | None = None
    reportDate: dt.date | None = None
    photoId: int | None = None
    status: str | None = None  # Briefstatus (Entwurf/Freigegeben/…) bzw. Mangelstatus (offen/…/abgenommen)
    defectId: int | None = None
    company: str | None = None
    deadline: dt.date | None = None
    resolvedDate: dt.date | None = None  # ab hier ist der Mangel nicht mehr offen (behoben/abgenommen)


class BuildingProgress(BaseModel):
    projectId: int
    houses: list[str]
    levels: list[str]  # von unten nach oben
    rangeFrom: dt.date | None
    rangeTo: dt.date | None
    lastReportDate: dt.date | None  # danach gibt es keine Ist-Werte mehr → Ansicht zeigt Prognose
    tasks: list[BuildingTask]
    events: list[BuildingEvent]

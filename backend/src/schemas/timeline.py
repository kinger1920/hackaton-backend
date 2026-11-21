"""API-Schemas für GET /api/timeline (was ist auf der Baustelle passiert – chronologisch, mit Quelle)."""

import datetime as dt
from typing import Literal

from pydantic import BaseModel

TimelineType = Literal["report", "note", "notice", "progress", "alert"]
TIMELINE_TYPES: tuple[str, ...] = ("report", "note", "notice", "progress", "alert")


class TimelineItem(BaseModel):
    id: str  # stabil, z. B. "report-12", "notice-3-approved"
    type: TimelineType
    date: dt.date
    time: str | None = None  # "HH:MM" (UTC), wenn bekannt
    title: str
    summary: str
    source: str  # Quellenangabe wie überall: "Tagesbericht 17.11.2026", "Diktat 21.11.2026 14:03" …
    refId: int | None = None  # ID des Datensatzes (Bericht, Notiz, Brief …)
    severity: Literal["critical", "warning", "info"] | None = None


class Timeline(BaseModel):
    """Antwort von GET /api/timeline – neueste Einträge zuerst."""

    projectId: int
    dateFrom: dt.date
    dateTo: dt.date
    items: list[TimelineItem]

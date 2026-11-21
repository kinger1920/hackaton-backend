"""Schemas für den Projekt-Assistenten (POST /api/assistant/ask, GET/DELETE /api/assistant/history)
und das automatische Wetter (GET /api/weather)."""

import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field


class AssistantAskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    project_id: int
    ref_date: dt.date | None = None  # Stichtag für „letzte Woche“, Soll/Ist usw. (Default: heute)


class AssistantAnswer(BaseModel):
    """Format `AssistantAnswer` im Frontend (services/api.ts)."""

    answer: str
    sources: list[str]  # nur Labels, die es wirklich gibt (z. B. "Tagesbericht 17.11.2026")
    mode: Literal["ai", "offline"]
    session_id: int | None = None


class AssistantMessage(BaseModel):
    id: int
    role: Literal["user", "assistant"]
    text: str
    sources: list[str] = []
    mode: Literal["ai", "offline"] | None = None
    created_at: dt.datetime


class WeatherResponse(BaseModel):
    """Format `WeatherResponse` im Frontend (services/api.ts)."""

    date: dt.date
    temperature_c: float | None
    condition: str
    wind_kmh: float | None = None
    precipitation_mm: float | None = None
    source: str

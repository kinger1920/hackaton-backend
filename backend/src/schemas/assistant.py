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
    # Zusätzlich für die Dashboard-Kachel (alle optional, None = unbekannt):
    wind_gusts_kmh: float | None = None
    precipitation_probability: int | None = None  # % (nur Vorhersage, nicht Archiv)
    t_min: float | None = None
    t_max: float | None = None
    place: str | None = None
    crane_status: str | None = None  # Böen ≥ 45 km/h → Warnung (services/weather.site_hints)
    is_wind_warning: bool | None = None
    concrete_status: str | None = None  # Tiefsttemperatur ≤ +5 °C → Winterbaumaßnahmen

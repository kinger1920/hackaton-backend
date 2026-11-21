"""API-Schemas für Tagesberichte (Contract §3: GET/PUT /api/reports/{date}, POST /api/reports/{date}/fill).

Felder folgen Jues Formular (`frontend/src/reports/DailyReports.tsx`) und API_CONTRACT `DailyReport`
(snake_case). Gespeichert wird in Yannicks Tabelle `DailyReport` + unserer `ReportProgress`.
"""

import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field

ProgressSource = Literal["diktat", "ki", "regel", "nutzer"]


class ProgressIn(BaseModel):
    """Fortschritt eines Vorgangs aus dem Projektplan, vom Nutzer gesetzt."""

    task_id: int
    percent: int = Field(ge=0, le=100, description="Fertigstellungsgrad 0–100 %")
    note: str | None = None


class ProgressOut(BaseModel):
    task_id: int
    task_code: str | None
    title: str
    percent: int
    source: ProgressSource
    note: str | None = None


class AttendanceItem(BaseModel):
    """Anwesenheit einer Firma bzw. eines Gewerks an diesem Tag (gespeichert im workforce-JSON)."""

    company: str | None = Field(default=None, description="Firma, z. B. 'Erdbau Krause GmbH'")
    trade: str | None = Field(default=None, description="Gewerk, z. B. 'Erdbau'")
    workers: int = Field(ge=0, description="Anzahl Arbeitskräfte vor Ort")
    hours: float | None = Field(default=None, ge=0)


class ReportIn(BaseModel):
    """Body für PUT: kompletter Formularstand (nicht gesendete Felder werden geleert).

    `progress` / `attendance` = None lassen den Stand unverändert; eine Liste ersetzt ihn komplett.
    `workforce_count` leer + Anwesenheit angegeben → Summe der Anwesenheit.
    """

    report_number: int | None = None
    weather: str | None = Field(default=None, description="Freitext, z. B. 'bedeckt, windstill'")
    temperature_c: float | None = Field(default=None, ge=-40, le=50, description="Temperatur in °C")
    site_manager: str | None = Field(default=None, description="Bauleitung des Tages")
    workforce_count: int | None = Field(default=None, ge=0)
    trades: list[str] = Field(default_factory=list)
    work_completed: str | None = None
    deviations_incidents: str | None = None
    deliveries: str | None = None
    summary: str | None = None
    status: Literal["draft", "reviewed", "finalized"] = "draft"
    progress: list[ProgressIn] | None = None
    attendance: list[AttendanceItem] | None = None


class ReportOut(BaseModel):
    """Ein Tagesbericht. `id` ist None, solange der Tag noch nicht gespeichert wurde."""

    id: int | None
    project_id: int
    report_date: dt.date
    report_number: int | None
    weather: str | None
    temperature_c: float | None = None
    site_manager: str | None = None
    workforce_count: int | None
    trades: list[str]
    work_completed: str | None
    deviations_incidents: str | None
    deliveries: str | None
    summary: str | None
    status: str
    progress: list[ProgressOut]
    attendance: list[AttendanceItem] = Field(default_factory=list)


class FillRequest(BaseModel):
    """Body für POST /fill: Diktat oder Text, der den Bericht des Tages ergänzt."""

    text: str = Field(min_length=1)
    lang: str = "de"
    project_id: int | None = None


class FillResponse(ReportOut):
    """Ergänzter Bericht + Modus (ai/offline) + ID des neuen Tagebucheintrags."""

    mode: Literal["ai", "offline"]
    site_note_id: int | None = None

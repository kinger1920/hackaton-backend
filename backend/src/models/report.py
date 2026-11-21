from datetime import datetime, date, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


class DailyReportBase(SQLModel):
    project_id: int = Field(foreign_key="project.id", index=True)
    report_date: date = Field(index=True)
    summary: Optional[str] = None
    weather: Optional[str] = None  # JSON string: e.g. {"temp_c": 12, "condition": "bewölkt", "rain_mm": 0}
    workforce: Optional[str] = None  # JSON string: e.g. [{"trade": "Rohbau", "workers": 8, "hours": 64}]
    equipment: Optional[str] = None  # JSON string: e.g. [{"machine": "Kran 1", "hours": 7}]
    work_completed: Optional[str] = None
    deviations_incidents: Optional[str] = None
    status: str = Field(default="draft")  # draft, reviewed, finalized, exported
    # Ergänzt für das Formular im Frontend (DailyReports.tsx). Nullable, damit ältere DBs per
    # Spalten-Ergänzung in database.py weiterlaufen.
    report_number: Optional[int] = None  # laufende Nr. des Bautagesberichts
    workforce_count: Optional[int] = None  # Personal gesamt (Personen)
    trades: Optional[str] = None  # JSON-Liste: ["Rohbau (Fa. BetonTech)", "Tiefbau"]
    deliveries: Optional[str] = None  # Lieferungen, Abnahmen & Prüfungen


class DailyReport(DailyReportBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DailyReportCreate(DailyReportBase):
    pass


class DailyReportRead(DailyReportBase):
    id: int
    created_at: datetime
    updated_at: datetime

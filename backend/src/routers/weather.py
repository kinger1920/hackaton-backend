"""Automatisches Wetter: GET /api/weather?project_id=&date=

Wetter am Projektstandort (Open-Meteo, siehe services/weather.py). Ist der Dienst nicht erreichbar,
wird das im Tagesbericht des Tages gespeicherte Wetter zurückgegeben (Quelle "Tagesbericht").
"""

import datetime as dt
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from src.database import get_session
from src.models import DailyReport, Project
from src.schemas.assistant import WeatherResponse
from src.services import weather

router = APIRouter(prefix="/api", tags=["Weather"])


def _from_report(session: Session, project_id: int, day: dt.date) -> WeatherResponse | None:
    report = session.exec(
        select(DailyReport).where(DailyReport.project_id == project_id, DailyReport.report_date == day)
    ).first()
    if report is None or not report.weather:
        return None
    try:
        data = json.loads(report.weather)
    except ValueError:
        data = {"condition": report.weather}
    if not isinstance(data, dict) or not (data.get("condition") or data.get("temp_c") is not None):
        return None
    return WeatherResponse(
        date=day,
        temperature_c=data.get("temp_c"),
        condition=str(data.get("condition") or ""),
        precipitation_mm=data.get("rain_mm"),
        source=f"Tagesbericht {day.strftime('%d.%m.%Y')} (Wetterdienst nicht erreichbar)",
    )


@router.get("/weather", response_model=WeatherResponse)
async def get_weather(date: dt.date, project_id: int | None = None,
                      session: Session = Depends(get_session)) -> WeatherResponse:
    """Tageswetter am Baustellenstandort.

    Input:  date (ISO), project_id (Standort aus `Project.location`; ohne → erstes Projekt mit Standort).
    Output: {date, temperature_c, condition, wind_kmh, precipitation_mm, source}
    Fehler: 404 Projekt unbekannt, 422 Projekt ohne Standort, 503 Wetterdienst nicht erreichbar
            und kein gespeichertes Wetter im Tagesbericht.
    """
    if project_id is not None:
        project = session.get(Project, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail=f"Projekt {project_id} nicht gefunden")
    else:
        project = session.exec(select(Project).where(Project.location.is_not(None))).first()
    if project is None or not (project.location or "").strip():
        raise HTTPException(status_code=422,
                            detail="Projekt hat keinen Standort – bitte in Projekte → Bearbeiten den Ort eintragen.")
    try:
        return WeatherResponse(**await weather.fetch_weather(project.location, date))
    except weather.WeatherUnavailable as exc:
        fallback = _from_report(session, project.id, date)
        if fallback is not None:
            return fallback
        raise HTTPException(status_code=503, detail=str(exc)) from exc

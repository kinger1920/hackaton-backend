"""Tagesaufgaben/Termine (Zukunft) und Timeline (Vergangenheit) eines Projekts.

GET /api/schedule  – Board: "Tagesaufgaben aus Terminplan ableiten"
GET /api/timeline  – Board: "Timeline API: Fotos, Berichte, Mängel"
"""

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session

from src.database import get_session
from src.schemas.schedule import Schedule
from src.schemas.timeline import TIMELINE_TYPES, Timeline
from src.services import schedule as schedule_service
from src.services import timeline as timeline_service
from src.services.reports import resolve_project

router = APIRouter(prefix="/api", tags=["Schedule & Timeline"])

MAX_RANGE_DAYS = 92


@router.get("/schedule", response_model=Schedule)
def get_schedule(project_id: int | None = None, date_from: dt.date | None = Query(None, alias="from"),
                 days: int = Query(7, ge=1, le=31), ref_date: dt.date | None = None,
                 session: Session = Depends(get_session)) -> Schedule:
    """Aufgaben je Werktag + Termine im SiteAppointment-Format (für Jues Termin-Seite).

    Input: `from` (Default: ref_date bzw. heute), `days` 1–31, `ref_date` = Stand des Ist-Fortschritts.
    Fehler: 404 Projekt unbekannt · 422 ungültige Parameter (FastAPI).
    """
    project = resolve_project(session, project_id)
    ref = ref_date or dt.date.today()
    return schedule_service.schedule(session, project, date_from or ref, days, ref)


@router.get("/timeline", response_model=Timeline)
def get_timeline(project_id: int | None = None, date_from: dt.date | None = Query(None, alias="from"),
                 date_to: dt.date | None = Query(None, alias="to"),
                 types: str = Query(",".join(TIMELINE_TYPES), description="Kommagetrennt: " + ", ".join(TIMELINE_TYPES)),
                 session: Session = Depends(get_session)) -> Timeline:
    """Ereignisse der Baustelle, neueste zuerst. Default: letzte 14 Tage bis heute.

    Fehler: 404 Projekt unbekannt · 422 from > to, Zeitraum > 92 Tage oder unbekannter Typ.
    """
    project = resolve_project(session, project_id)
    end = date_to or dt.date.today()
    start = date_from or end - dt.timedelta(days=13)
    wanted = [t.strip() for t in types.split(",") if t.strip()]
    unknown = sorted(set(wanted) - set(TIMELINE_TYPES))
    # 422: formal gültige Anfrage, aber unsinnige Werte – lieber klar ablehnen als still ignorieren.
    if unknown:
        raise HTTPException(status_code=422, detail={"unknown_types": unknown})
    if start > end:
        raise HTTPException(status_code=422, detail="'from' liegt nach 'to'")
    if (end - start).days >= MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail=f"Zeitraum maximal {MAX_RANGE_DAYS} Tage")
    return timeline_service.timeline(session, project, start, end, wanted or list(TIMELINE_TYPES))

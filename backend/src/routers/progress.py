"""Baufortschritt als Gebäude: GET /api/progress/building?project_id=

Router bleibt dünn – Daten und Ortserkennung in services/progress_map.py.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from src.database import get_session
from src.models import Project
from src.schemas.progress import BuildingProgress
from src.services import progress_map

router = APIRouter(prefix="/api/progress", tags=["Analysis"])


@router.get("/building", response_model=BuildingProgress)
def building(project_id: int, session: Session = Depends(get_session)) -> BuildingProgress:
    """Plan, Ist-Verlauf und Ereignisse je Haus/Ebene – das Frontend rechnet den Zustand je Stichtag selbst.

    Output: {houses[], levels[] (unten→oben), rangeFrom, rangeTo, lastReportDate,
             tasks[{id, title, house, level, plannedStart, plannedEnd, durationDays, history[{date, percent}], …}],
             events[{kind: defect|hindrance|incident|photo, date, title, house, level, taskIds[], source, …}]}
    Fehler: 404 unbekanntes Projekt.
    """
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Projekt {project_id} nicht gefunden")
    return progress_map.build(session, project)

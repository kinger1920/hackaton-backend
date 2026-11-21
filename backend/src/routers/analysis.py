"""Soll/Ist-Analyse, Tagesanalyse und Dashboard (Contract §3: GET /api/dashboard, Bereich "Analysis").

Router bleibt dünn – alle Berechnungen liegen in services/analysis.py.
`project_id` als Query-Parameter; ohne Angabe gilt das erste Projekt (404, wenn unbekannt).
"""

import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends
from sqlmodel import Session

from src.database import get_session
from src.schemas.analysis import Dashboard, DayAnalysis, PlanAnalysis
from src.services import analysis
from src.services.reports import resolve_project

router = APIRouter(prefix="/api", tags=["Analysis"])


@router.get("/analysis", response_model=PlanAnalysis)
def get_analysis(project_id: int | None = None, period: Literal["week", "all"] = "week",
                 ref_date: dt.date | None = None, session: Session = Depends(get_session)) -> PlanAnalysis:
    """Soll/Ist je Vorgang zum Stichtag + Abweichungen der Woche (`week`) oder aller Berichte (`all`).

    Format wie `frontend/src/analysis/Analysis.tsx`. Projekt ohne Plan → leere `workPackages`.
    """
    project = resolve_project(session, project_id)
    return analysis.analyze_plan(session, project, period, ref_date or dt.date.today())


@router.get("/reports/{report_date}/analysis", response_model=DayAnalysis)
async def get_day_analysis(report_date: dt.date, project_id: int | None = None,
                           session: Session = Depends(get_session)) -> DayAnalysis:
    """Was lief an diesem Tag gut, was lief schlecht – jeweils mit Quelle. Ohne KI: Regeln."""
    project = resolve_project(session, project_id)
    return await analysis.analyze_day(session, project, report_date)


@router.get("/dashboard", response_model=Dashboard)
def get_dashboard(project_id: int | None = None, ref_date: dt.date | None = None,
                  session: Session = Depends(get_session)) -> Dashboard:
    """Kennzahlen, Warnungen und Fortschritt für die Startseite (Contract: {kpis, alerts[], progress[]})."""
    project = resolve_project(session, project_id)
    return analysis.dashboard(session, project, ref_date or dt.date.today())

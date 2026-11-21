"""Zusammenfassungs-Endpunkt (Contract §3: POST /api/summarize, Bereich "AI").

Router bleibt dünn: Eingabe prüfen, Projekt laden, Service aufrufen.
Antwortet auch ohne KI mit 200 und derselben Form (Offline-Fallback).
"""

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from src.database import get_session
from src.models import Project
from src.schemas.summary import SummarizeRequest, SummaryResponse
from src.services import summary

router = APIRouter(prefix="/api", tags=["Summaries"])


@router.post("/summarize", response_model=SummaryResponse)
async def summarize(req: SummarizeRequest, session: Session = Depends(get_session)) -> SummaryResponse:
    """Zusammenfassung auf Anfrage (Contract: POST /api/summarize).

    Input (genau ein Modus, sonst 422):
      - Zeitraum: {project_id, period: "week"|"month", ref_date?}  → Woche/Monat aus Tagesberichten,
        Tagebuchnotizen und Briefen des Projekts.
      - Text:     {text, source_type?, project_id?}                  → E-Mail, Protokoll, Tagebuchauszug.
    Output: Format `DocumentSummary` des Frontends + Quellen, Kennzahlen, Zeitraum, Modus.
    Fehler: 404, wenn `project_id` unbekannt ist.
    """
    project = None
    if req.project_id is not None:
        project = session.get(Project, req.project_id)
        if project is None:
            raise HTTPException(status_code=404, detail=f"Projekt {req.project_id} nicht gefunden")

    if req.period is not None:
        return await summary.summarize_period(session, project, req.period, req.ref_date or dt.date.today())
    return await summary.summarize_text(req.text, req.source_type, project)

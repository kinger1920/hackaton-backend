"""KI-Endpunkte (Contract §3, Bereich "AI"): /api/capture, /api/transcribe, /api/notices/{id}/review.

Router bleiben dünn: Sie prüfen Eingaben, rufen den passenden Service auf und speichern
bei Bedarf. Alle Endpunkte antworten auch ohne KI mit 200 und der normalen Form (Offline-Fallback).
"""

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlmodel import Session, select

from src.database import get_session
from src.models import FormalNotice, Project, SiteNote
from src.schemas.ai import CaptureRequest, NoticeDraft, ReviewResponse, TranscribeResponse
from src.services import extraction, review, stt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["AI"])


@router.post("/capture", response_model=NoticeDraft)
async def capture(req: CaptureRequest, session: Session = Depends(get_session)) -> NoticeDraft:
    """Diktat/Text → Brief-Entwurf (Contract: POST /api/capture).

    Input:  {text, lang, ref_date?, ref_time?, force_type?} – Pydantic prüft das (422 bei Fehlern).
    Output: NoticeDraft mit Typ, Feldern (je mit Quelle), Rückfragen, Modus (ai/offline)
            und der ID des neuen Tagebucheintrags.
    """
    draft = await extraction.capture(req)

    # Contract: Jede Erfassung erzeugt auch einen Tagebucheintrag. Im Repo heißt das
    # Modell `SiteNote`. Es braucht ein Projekt – solange es keine Projektauswahl gibt,
    # nehmen wir das erste Projekt der Datenbank.
    project = session.exec(select(Project).order_by(Project.id)).first()
    if project is None:
        logger.warning("Kein Projekt in der DB – Tagebucheintrag wird nicht gespeichert.")
        return draft

    # API_CONTRACT.md erlaubt als category nur delay/incident/weather/progress/defect/general.
    category = draft.type if draft.type in ("delay", "defect") else "general"
    note = SiteNote(project_id=project.id, content=req.text, category=category, status="processed")
    session.add(note)
    session.commit()
    session.refresh(note)
    draft.site_note_id = note.id
    return draft


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    audio: UploadFile = File(..., description="Audio-Diktat (webm, m4a, mp3, wav)"),
    lang: str = Form("de", description="Sprache, z. B. de oder pl"),
) -> TranscribeResponse:
    """Audio → Text (Contract: POST /api/transcribe, multipart).

    Bei KI-Ausfall kommt leerer Text zurück (Status 200). Das Frontend nutzt dann
    seine Browser-Spracherkennung.
    """
    data = await audio.read()
    text = await stt.transcribe(data, audio.filename or "audio.webm", lang)
    return TranscribeResponse(text=text or "", lang=lang)


@router.post("/notices/{notice_id}/review", response_model=ReviewResponse)
async def review_notice(notice_id: int, session: Session = Depends(get_session)) -> ReviewResponse:
    """Prüfhinweise zu einem gespeicherten Entwurf (liest FormalNotice.body) (Contract: POST /api/notices/{id}/review).

    Fehler: 404, wenn es keine Notice mit dieser ID gibt.
    """
    notice = session.get(FormalNotice, notice_id)
    if notice is None:
        raise HTTPException(status_code=404, detail=f"Notice {notice_id} nicht gefunden")
    hints, mode = await review.review(notice)
    return ReviewResponse(hints=hints, mode=mode)

"""Projekt-Assistent: POST /api/assistant/ask, GET/DELETE /api/assistant/history.

Router bleibt dünn: Projekt prüfen, Service fragen, Verlauf in ChatSession/ChatMessage speichern
(eine Sitzung „Projekt-Assistent“ je Projekt). Antwortet auch ohne KI mit 200 (mode "offline").
"""

import datetime as dt
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from src.database import get_session
from src.models import ChatMessage, ChatSession, Project
from src.schemas.assistant import AssistantAnswer, AssistantAskRequest, AssistantMessage
from src.services import assistant

router = APIRouter(prefix="/api/assistant", tags=["Assistant"])

SESSION_TITLE = "Projekt-Assistent"


def _project_or_404(session: Session, project_id: int) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Projekt {project_id} nicht gefunden")
    return project


def _chat_session(session: Session, project_id: int, create: bool) -> ChatSession | None:
    chat = session.exec(
        select(ChatSession)
        .where(ChatSession.project_id == project_id, ChatSession.title == SESSION_TITLE)
        .order_by(ChatSession.id)
    ).first()
    if chat is None and create:
        chat = ChatSession(project_id=project_id, title=SESSION_TITLE)
        session.add(chat)
        session.flush()
    return chat


@router.post("/ask", response_model=AssistantAnswer)
async def ask(req: AssistantAskRequest, session: Session = Depends(get_session)) -> AssistantAnswer:
    """Frage zum Projekt beantworten – nur aus Projektdaten, jede Antwort mit Quellen-Labels.

    Input:  {question, project_id, ref_date?}
    Output: {answer, sources[], mode: "ai"|"offline", session_id}
    Fehler: 404 unbekanntes Projekt, 422 leere Frage.
    """
    project = _project_or_404(session, req.project_id)
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="Frage ist leer")
    answer, sources, mode = await assistant.ask(session, project, question, req.ref_date or dt.date.today())

    chat = _chat_session(session, project.id, create=True)
    session.add(ChatMessage(session_id=chat.id, role="user", content=question))
    session.add(ChatMessage(session_id=chat.id, role="assistant", content=answer,
                            metadata_json=json.dumps({"sources": sources, "mode": mode}, ensure_ascii=False)))
    session.commit()
    return AssistantAnswer(answer=answer, sources=sources, mode=mode, session_id=chat.id)


@router.get("/history", response_model=list[AssistantMessage])
def history(project_id: int, limit: int = 100, session: Session = Depends(get_session)) -> list[AssistantMessage]:
    """Bisheriger Chat-Verlauf des Projekts (älteste zuerst, höchstens `limit` neueste Nachrichten)."""
    _project_or_404(session, project_id)
    chat = _chat_session(session, project_id, create=False)
    if chat is None:
        return []
    rows = session.exec(
        select(ChatMessage).where(ChatMessage.session_id == chat.id).order_by(ChatMessage.id.desc()).limit(limit)
    ).all()
    out = []
    for m in reversed(rows):
        meta = {}
        if m.metadata_json:
            try:
                meta = json.loads(m.metadata_json)
            except ValueError:
                meta = {}
        out.append(AssistantMessage(
            id=m.id, role="user" if m.role == "user" else "assistant", text=m.content,
            sources=meta.get("sources") or [], mode=meta.get("mode"), created_at=m.created_at,
        ))
    return out


@router.delete("/history", status_code=204)
def clear_history(project_id: int, session: Session = Depends(get_session)) -> None:
    """Chat-Verlauf des Projekts löschen (neuer Chat)."""
    _project_or_404(session, project_id)
    chat = _chat_session(session, project_id, create=False)
    if chat is None:
        return
    for m in session.exec(select(ChatMessage).where(ChatMessage.session_id == chat.id)).all():
        session.delete(m)
    session.flush()
    session.delete(chat)
    session.commit()

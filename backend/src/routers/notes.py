from fastapi import APIRouter, Depends
from sqlalchemy import insert
from sqlmodel import Session, select

from src.database import get_session
from src.models import SiteNote, SiteNoteRead

router = APIRouter(prefix="/site-notes", tags=["Site Notes"])


@router.get("", response_model=list[SiteNoteRead], tags=["Site Notes"])
def get_all_site_notes(
        project_id: int | None = None,
        session: Session = Depends(get_session)
):
    statement = select(SiteNote)
    if project_id is not None:
        statement = statement.where(SiteNote.project_id == project_id)

    return session.exec(statement).all()


@router.get("/{note_id}", response_model=SiteNoteRead, tags=["Site Notes"])
def get_site_note_by_id(
        note_id: int,
        session: Session = Depends(get_session)
):
    statement = select(SiteNote)
    if note_id is not None:
        statement = statement.where(SiteNote.id == note_id)

    return session.exec(statement).one_or_none()


@router.post("/create-site-note", response_model=SiteNoteRead, tags=["Site Notes"])
def create_site_note(
        content: str,
        author: str | None,
        audio_file_path: str | None = None,
        category: str | None = None,
        project_id: int | None = None,
        session: Session = Depends(get_session)
):
    statement = insert(SiteNote)

    if content is not None:
        statement = statement.values(
            content=content,
            author=author,
            audio_file_path=audio_file_path,
            category=category,
            project_id=project_id
        )

    return session.exec(statement)

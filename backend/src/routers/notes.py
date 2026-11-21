from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from src.database import get_session
from src.models import Project, SiteNote, SiteNoteCreate, SiteNoteRead

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


@router.post("/create", response_model=SiteNoteRead, status_code=status.HTTP_201_CREATED, tags=["Site Notes"])
def create_site_note(
        note: SiteNoteCreate,
        session: Session = Depends(get_session)
):
    if not session.get(Project, note.project_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    db_note = SiteNote.model_validate(note)
    session.add(db_note)
    session.commit()
    session.refresh(db_note)
    return db_note


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Site Notes"])
def delete_site_note(
        note_id: int,
        session: Session = Depends(get_session)
):
    note = session.get(SiteNote, note_id)
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SiteNote not found")

    session.delete(note)
    session.commit()

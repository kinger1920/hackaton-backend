from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from src.database import get_session
from src.models import (
    Appointment,
    ChatMessage,
    ChatSession,
    ConstructionPlan,
    Contract,
    DailyReport,
    Defect,
    FormalNotice,
    NoticeDraftData,
    PlanTask,
    Project,
    ProjectCreate,
    ProjectDocument,
    ProjectRead,
    ProjectUpdate,
    ReportProgress,
    SiteNote,
    SitePhoto,
)
from src.schemas.projects import ProjectCreateIn, ProjectUpdateIn, ProjectWithContractors
from src.services.contracts import delete_contract_file
from src.services.photos import delete_photo_file
from src.services.project_master import sync_contractors, with_contractors

router = APIRouter(prefix="/projects", tags=["Projects"])


@router.get("", response_model=list[ProjectWithContractors])
def list_projects(session: Session = Depends(get_session)):
    return [with_contractors(session, p) for p in session.exec(select(Project)).all()]


@router.get("/{project_id}", response_model=ProjectWithContractors)
def get_project(project_id: int, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    return with_contractors(session, project)


@router.post("", response_model=ProjectWithContractors, status_code=status.HTTP_201_CREATED)
def create_project(
    project: ProjectCreateIn,
    session: Session = Depends(get_session),
):
    # Firmenliste (contractors) wird zu Firmen + Verträgen (Sollstärke), nicht zur Projektspalte.
    db_project = Project.model_validate(project.model_dump(exclude={"contractors"}))
    session.add(db_project)
    session.flush()
    if project.contractors:
        sync_contractors(session, db_project, project.contractors)
    session.commit()
    session.refresh(db_project)
    return with_contractors(session, db_project)


@router.patch("/{project_id}", response_model=ProjectWithContractors)
def update_project(
    project_id: int,
    project_update: ProjectUpdateIn,
    session: Session = Depends(get_session),
):
    db_project = session.get(Project, project_id)
    if not db_project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    update_data = project_update.model_dump(exclude_unset=True, exclude={"contractors"})
    db_project.sqlmodel_update(update_data)
    db_project.updated_at = datetime.now(timezone.utc)
    if project_update.start_date or project_update.end_date:
        start = db_project.start_date
        end = db_project.end_date
        if start and end and end < start:
            raise HTTPException(status_code=422, detail="end_date liegt vor start_date")
    session.add(db_project)
    if project_update.contractors is not None:  # None = Firmenliste unverändert
        sync_contractors(session, db_project, project_update.contractors)
    session.commit()
    session.refresh(db_project)
    return with_contractors(session, db_project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, session: Session = Depends(get_session)):
    db_project = session.get(Project, project_id)
    if not db_project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Delete dependent child rows cleanly (foreign_keys=ON in SQLite)
    chat_sessions = session.exec(
        select(ChatSession).where(ChatSession.project_id == project_id)
    ).all()
    for chat_session in chat_sessions:
        messages = session.exec(
            select(ChatMessage).where(ChatMessage.session_id == chat_session.id)
        ).all()
        for msg in messages:
            session.delete(msg)
        session.flush()
        session.delete(chat_session)

    plans = session.exec(
        select(ConstructionPlan).where(ConstructionPlan.project_id == project_id)
    ).all()
    for plan in plans:
        tasks = session.exec(
            select(PlanTask).where(PlanTask.plan_id == plan.id)
        ).all()
        for task in tasks:
            for prog in session.exec(select(ReportProgress).where(ReportProgress.task_id == task.id)).all():
                session.delete(prog)
            session.flush()
            session.delete(task)
        session.flush()
        session.delete(plan)

    reports = session.exec(select(DailyReport).where(DailyReport.project_id == project_id)).all()
    for rep in reports:
        for prog in session.exec(select(ReportProgress).where(ReportProgress.report_id == rep.id)).all():
            session.delete(prog)
        session.flush()
        session.delete(rep)

    notices = session.exec(select(FormalNotice).where(FormalNotice.project_id == project_id)).all()
    for notice in notices:
        for draft_data in session.exec(select(NoticeDraftData).where(NoticeDraftData.notice_id == notice.id)).all():
            session.delete(draft_data)
        session.flush()
        session.delete(notice)

    contracts = session.exec(select(Contract).where(Contract.project_id == project_id)).all()
    contract_files = [c.file_path for c in contracts]
    for contract in contracts:
        session.delete(contract)

    photos = session.exec(select(SitePhoto).where(SitePhoto.project_id == project_id)).all()
    photo_files = [p.file_path for p in photos]
    for photo in photos:
        session.delete(photo)

    for model in (SiteNote, Appointment, ProjectDocument, Defect):
        rows = session.exec(select(model).where(model.project_id == project_id)).all()
        for row in rows:
            session.delete(row)

    session.flush()
    session.delete(db_project)
    session.commit()

    for file_path in contract_files:
        delete_contract_file(file_path)
    for file_path in photo_files:
        delete_photo_file(file_path)

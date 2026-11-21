"""Vorgänge eines Bauzeitenplans: Import (CSV/PDF), Bulk-Übernahme und Einzel-CRUD.

Eigener Router neben Yannicks `/plans` (Plan-Datei/Metadaten), damit dessen Datei unverändert bleibt.
"""

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlmodel import Session, select

from src.database import get_session
from src.models import ConstructionPlan, PlanTask, PlanTaskRead, ReportProgress
from src.schemas.plan_tasks import BulkRequest, ImportResult, TaskIn, TaskPatch
from src.services import plan_import
from src.services.contracts import extract_pdf_text

router = APIRouter(prefix="/api/plans", tags=["Construction Plans"])

MAX_BYTES = 5 * 1024 * 1024


def _plan_or_404(session: Session, plan_id: int) -> ConstructionPlan:
    plan = session.get(ConstructionPlan, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id} nicht gefunden")
    return plan


def _task_or_404(session: Session, plan_id: int, task_id: int) -> PlanTask:
    task = session.get(PlanTask, task_id)
    if task is None or task.plan_id != plan_id:
        raise HTTPException(status_code=404, detail=f"Vorgang {task_id} nicht in Plan {plan_id}")
    return task


@router.post("/{plan_id}/import", response_model=ImportResult)
async def import_tasks(plan_id: int, file: UploadFile = File(...), dry_run: bool = False,
                       session: Session = Depends(get_session)) -> ImportResult:
    """Terminplan-Datei lesen: .csv wird übernommen (dry_run=true → nur Vorschau), .pdf ist IMMER Vorschau.

    PDF-Vorschau bestätigen: POST /api/plans/{id}/tasks/bulk mit der (ggf. korrigierten) Liste.
    Fehler: 404 Plan · 413 > 5 MB · 415 weder CSV noch PDF · 422 leer/keine Spalten/kein Text.
    """
    plan = _plan_or_404(session, plan_id)
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Datei größer als 5 MB")
    name = (file.filename or "").lower()
    is_pdf = name.endswith(".pdf") or file.content_type == "application/pdf" or data[:4] == b"%PDF"
    is_csv = name.endswith((".csv", ".txt")) or (file.content_type or "").startswith("text/")
    if not is_pdf and not is_csv:
        # 415 = Dateityp wird nicht unterstützt (z. B. .xlsx → bitte als CSV speichern).
        raise HTTPException(status_code=415, detail="Nur CSV oder PDF (Excel bitte als CSV speichern)")

    if is_pdf:
        text = extract_pdf_text(data)
        if not text.strip():
            raise HTTPException(status_code=422, detail="PDF enthält keinen Text (Scan?)")
        tasks, warnings, mode = await plan_import.parse_pdf_text(text)
        return ImportResult(planId=plan.id, mode=mode, dryRun=True, tasks=tasks, errors=[], warnings=warnings,
                            created=0, updated=0)

    try:
        tasks, errors = plan_import.parse_csv(data)
    except plan_import.NoColumns as e:
        raise HTTPException(status_code=422, detail=str(e))
    created = updated = 0
    if not dry_run:
        created, updated = plan_import.apply(session, plan, tasks)
        session.commit()
    return ImportResult(planId=plan.id, mode="csv", dryRun=dry_run, tasks=tasks, errors=errors, warnings=[],
                        created=created, updated=updated)


@router.post("/{plan_id}/tasks/bulk", response_model=ImportResult)
def bulk_tasks(plan_id: int, body: BulkRequest, session: Session = Depends(get_session)) -> ImportResult:
    """Bestätigte Vorschau übernehmen (Upsert per Code/Titel, nichts wird gelöscht)."""
    plan = _plan_or_404(session, plan_id)
    created, updated = plan_import.apply(session, plan, body.tasks)
    session.commit()
    return ImportResult(planId=plan.id, mode="csv", dryRun=False, tasks=body.tasks, errors=[], warnings=[],
                        created=created, updated=updated)


@router.get("/{plan_id}/tasks", response_model=list[PlanTaskRead])
def list_tasks(plan_id: int, session: Session = Depends(get_session)):
    _plan_or_404(session, plan_id)
    return session.exec(select(PlanTask).where(PlanTask.plan_id == plan_id)
                        .order_by(PlanTask.planned_start, PlanTask.id)).all()


@router.post("/{plan_id}/tasks", response_model=PlanTaskRead, status_code=201)
def create_task(plan_id: int, body: TaskIn, session: Session = Depends(get_session)):
    _plan_or_404(session, plan_id)
    task = PlanTask(plan_id=plan_id, **body.model_dump())
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.patch("/{plan_id}/tasks/{task_id}", response_model=PlanTaskRead)
def update_task(plan_id: int, task_id: int, body: TaskPatch, session: Session = Depends(get_session)):
    task = _task_or_404(session, plan_id, task_id)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(task, key, value)
    if task.planned_start and task.planned_end and task.planned_end < task.planned_start:
        raise HTTPException(status_code=422, detail="planned_end liegt vor planned_start")
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.delete("/{plan_id}/tasks/{task_id}", status_code=204)
def delete_task(plan_id: int, task_id: int, force: bool = Query(False), session: Session = Depends(get_session)):
    """Löscht einen Vorgang. 409, wenn schon Fortschritt gemeldet wurde (Historie) – außer mit force=true."""
    task = _task_or_404(session, plan_id, task_id)
    progress = session.exec(select(ReportProgress).where(ReportProgress.task_id == task_id)).all()
    if progress and not force:
        # 409: Löschen würde die Soll/Ist-Historie der Tagesberichte zerstören.
        raise HTTPException(status_code=409, detail=f"Vorgang hat {len(progress)} Fortschrittsmeldungen – force=true zum Löschen")
    for p in progress:
        session.delete(p)
    session.flush()  # erst Fortschritt löschen, sonst blockiert der Fremdschlüssel
    session.delete(task)
    session.commit()

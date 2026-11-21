"""Mängelmanagement: /api/defects (Liste, Übersicht, Anlegen, Ändern, Löschen, Mängelliste Word/PDF).

Router bleibt dünn – Status-Logik, Ort-Erkennung und Export in services/defects.py.
"""

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session

from src.database import get_session
from src.models import Defect, Project
from src.schemas.defects import DefectIn, DefectOut, DefectPatch, DefectSummary
from src.services import defects
from src.services.documents import PdfUnavailable

router = APIRouter(prefix="/api/defects", tags=["Defects"])

STATUS_FILTER_LABELS = {None: "alle Mängel", "open": "offene Mängel", "offen": "Status offen",
                        "in_bearbeitung": "in Bearbeitung", "behoben": "behoben", "abgenommen": "abgenommen"}


def _project(session: Session, project_id: int) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Projekt {project_id} nicht gefunden")
    return project


def _defect(session: Session, defect_id: int) -> Defect:
    d = session.get(Defect, defect_id)
    if d is None:
        raise HTTPException(status_code=404, detail=f"Mangel {defect_id} nicht gefunden")
    return d


@router.get("", response_model=list[DefectOut])
def list_defects(project_id: int, status: str | None = None, company: str | None = None, house: str | None = None,
                 overdue: bool | None = None, ref_date: dt.date | None = None,
                 session: Session = Depends(get_session)) -> list[DefectOut]:
    """Mängel eines Projekts. `status`: offen | in_bearbeitung | behoben | abgenommen | open (= offen + in Bearbeitung).
    Sortierung: überfällige zuerst, dann offene nach Priorität und Frist."""
    _project(session, project_id)
    ref = ref_date or dt.date.today()
    return [defects.to_out(d, ref) for d in defects.query(session, project_id, status, company, house, overdue, ref)]


@router.get("/summary", response_model=DefectSummary)
def defect_summary(project_id: int, ref_date: dt.date | None = None,
                   session: Session = Depends(get_session)) -> DefectSummary:
    """Zählung je Status, offene/überfällige gesamt und je Firma (überfälligste Firma zuerst)."""
    _project(session, project_id)
    return defects.summary(session, project_id, ref_date or dt.date.today())


@router.get("/export/{fmt}")
def export_defects(fmt: str, project_id: int, status: str | None = "open", company: str | None = None,
                   ref_date: dt.date | None = None, session: Session = Depends(get_session)) -> Response:
    """Mängelliste als Word (`docx`) oder PDF (`pdf`, 503 ohne Pango). Default: offene Mängel."""
    project = _project(session, project_id)
    if fmt not in ("docx", "pdf"):
        raise HTTPException(status_code=404, detail="Format muss docx oder pdf sein")
    ref = ref_date or dt.date.today()
    status = status or None
    rows = defects.query(session, project_id, status, company, ref=ref)
    label = STATUS_FILTER_LABELS.get(status, status or "alle") + (f" · {company}" if company else "")
    name = f"Maengelliste_{project.number or project.id}_{ref.isoformat()}.{fmt}"
    headers = {"Content-Disposition": f'attachment; filename="{name}"'}
    if fmt == "docx":
        return Response(defects.render_docx(project, rows, ref, label), headers=headers,
                        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    try:
        return Response(defects.render_pdf(project, rows, ref, label), media_type="application/pdf", headers=headers)
    except PdfUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("", response_model=DefectOut, status_code=201)
def create_defect(data: DefectIn, session: Session = Depends(get_session)) -> DefectOut:
    """Mangel anlegen. Haus/Ebene werden aus `location`/`title` erkannt, wenn nicht angegeben."""
    _project(session, data.project_id)
    today = dt.date.today()
    return defects.to_out(defects.create(session, data, today), today)


@router.patch("/{defect_id}", response_model=DefectOut)
def update_defect(defect_id: int, data: DefectPatch, session: Session = Depends(get_session)) -> DefectOut:
    """Ändern inkl. Status-Wechsel (setzt/löscht resolved_date und accepted_date automatisch)."""
    today = dt.date.today()
    return defects.to_out(defects.patch(session, _defect(session, defect_id), data, today), today)


@router.delete("/{defect_id}", status_code=204)
def delete_defect(defect_id: int, session: Session = Depends(get_session)) -> None:
    session.delete(_defect(session, defect_id))
    session.commit()

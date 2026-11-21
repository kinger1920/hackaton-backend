"""Brief-Endpunkte (Contract §3): GET/PATCH /api/notices, POST /api/notices/{id}/approve.

Router bleiben dünn: Laden, Service aufrufen, Fehler in Statuscodes übersetzen.
Die Logik (Vorlagen, Pflichtfelder, Audit) liegt in `services/notices.py` und `services/letters.py`.
"""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session

from src.database import get_session
from src.models import FormalNotice, Project
from src.schemas.notices import ApproveConflict, NoticeOut, NoticePatch
from src.services import documents, notices

PDF_MEDIA_TYPE = "application/pdf"
DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

router = APIRouter(prefix="/api/notices", tags=["Notices"])


def _get_or_404(session: Session, notice_id: int) -> FormalNotice:
    notice = session.get(FormalNotice, notice_id)
    if notice is None:
        raise HTTPException(status_code=404, detail=f"Notice {notice_id} nicht gefunden")
    return notice


@router.get("", response_model=list[NoticeOut])
def list_notices(project_id: int | None = None, session: Session = Depends(get_session)) -> list[NoticeOut]:
    """Alle Brief-Entwürfe, neueste zuerst (Contract: GET /api/notices). Optional `?project_id=1`."""
    return [notices.to_out(n, d) for n, d in notices.list_notices(session, project_id)]


@router.get("/{notice_id}", response_model=NoticeOut)
def get_notice(notice_id: int, session: Session = Depends(get_session)) -> NoticeOut:
    """Ein Brief-Entwurf mit Feldern, Quellen und fehlenden Angaben. Fehler: 404."""
    notice = _get_or_404(session, notice_id)
    return notices.to_out(notice, notices.get_data(session, notice))


@router.patch("/{notice_id}", response_model=NoticeOut)
def patch_notice(notice_id: int, patch: NoticePatch, session: Session = Depends(get_session)) -> NoticeOut:
    """Felder oder Text eines Entwurfs ändern (Contract: PATCH /api/notices/{id}).

    Fehler: 404 unbekannte ID; 409, wenn der Brief schon freigegeben ist
    (freigegebene Schreiben dürfen sich nicht mehr unbemerkt ändern).
    """
    notice = _get_or_404(session, notice_id)
    data = notices.get_data(session, notice)
    try:
        notices.apply_patch(session, notice, data, patch)
    except notices.NoticeLocked:
        raise HTTPException(status_code=409, detail=f"Notice {notice_id} ist bereits '{notice.status}' und gesperrt")
    return notices.to_out(notice, data)


@router.post(
    "/{notice_id}/approve",
    response_model=NoticeOut,
    responses={409: {"description": "Pflichtangaben fehlen oder bereits freigegeben", "model": ApproveConflict}},
)
def approve_notice(notice_id: int, session: Session = Depends(get_session)) -> NoticeOut:
    """Gibt einen Entwurf frei (Contract: POST /api/notices/{id}/approve).

    Output: die freigegebene Notice mit Audit (approved_by, approved_at).
    Fehler: 404 unbekannte ID; 409 = "Conflict": die Anfrage ist gültig, passt aber nicht zum
    Zustand – Pflichtangaben fehlen (detail: missing_fields + questions) oder schon freigegeben.
    Human in the loop: Ohne vollständige Angaben darf kein Rechtsschreiben freigegeben werden.
    """
    notice = _get_or_404(session, notice_id)
    data = notices.get_data(session, notice)
    try:
        notices.approve(session, notice, data)
    except notices.MissingFields as e:
        raise HTTPException(
            status_code=409, detail=ApproveConflict(missing_fields=e.missing, questions=e.questions).model_dump()
        )
    except notices.NoticeLocked:
        raise HTTPException(status_code=409, detail=f"Notice {notice_id} ist bereits '{notice.status}'")
    return notices.to_out(notice, data)


def _export(notice_id: int, ext: str, session: Session) -> Response:
    """Gemeinsamer Ablauf für PDF und Word: laden → Freigabe prüfen → rendern → Datei-Download."""
    notice = _get_or_404(session, notice_id)
    data = notices.get_data(session, notice)
    project = session.get(Project, notice.project_id)
    try:
        # Erst prüfen, dann rendern: ein Entwurf wird nie als Datei herausgegeben.
        if notice.status == notices.STATUS_DRAFT:
            raise notices.NotApproved()
        content = documents.render_pdf(notice, data, project) if ext == "pdf" else documents.render_docx(notice, data, project)
        notices.mark_exported(session, notice)
    except notices.NotApproved:
        raise HTTPException(status_code=409, detail=f"Notice {notice_id} ist nicht freigegeben – Export erst nach /approve")
    except documents.PdfUnavailable as e:
        # 503 = Server kann gerade nicht: fehlende Systembibliothek, kein Fehler im Request.
        raise HTTPException(status_code=503, detail=str(e))

    media_type = PDF_MEDIA_TYPE if ext == "pdf" else DOCX_MEDIA_TYPE
    # Content-Disposition "attachment" → Browser lädt die Datei herunter statt sie anzuzeigen.
    headers = {"Content-Disposition": f'attachment; filename="{documents.filename(notice, project, ext)}"'}
    return Response(content=content, media_type=media_type, headers=headers)


@router.get(
    "/{notice_id}/pdf",
    response_class=Response,
    responses={200: {"content": {PDF_MEDIA_TYPE: {}}}, 409: {"description": "Noch nicht freigegeben"}},
)
def export_pdf(notice_id: int, session: Session = Depends(get_session)) -> Response:
    """Freigegebenen Brief als PDF herunterladen (Contract: GET /api/notices/{id}/pdf).

    Fehler: 404 unbekannte ID; 409 noch nicht freigegeben; 503 PDF-Bibliothek fehlt.
    Setzt den Status beim ersten Export auf "Exportiert".
    """
    return _export(notice_id, "pdf", session)


@router.get(
    "/{notice_id}/docx",
    response_class=Response,
    responses={200: {"content": {DOCX_MEDIA_TYPE: {}}}, 409: {"description": "Noch nicht freigegeben"}},
)
def export_docx(notice_id: int, session: Session = Depends(get_session)) -> Response:
    """Freigegebenen Brief als Word-Datei herunterladen (Contract: GET /api/notices/{id}/docx).

    Fehler: 404 unbekannte ID; 409 noch nicht freigegeben. Setzt den Status auf "Exportiert".
    """
    return _export(notice_id, "docx", session)

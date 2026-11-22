"""Tagesberichte (Contract §3: GET/PUT /api/reports/{date}, POST /api/reports/{date}/fill).

`date` im Format YYYY-MM-DD – ein ungültiges Datum beantwortet FastAPI mit 422.
`project_id` als Query-Parameter (bzw. im /fill-Body); ohne Angabe gilt das erste Projekt.
"""

import datetime as dt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlmodel import Session

from src.database import get_session
from src.schemas.reports import BulletRemoveRequest, FillRequest, FillResponse, ReportIn, ReportOut
from src.services import report_documents, reports
from src.services.documents import PdfUnavailable

PDF_MEDIA_TYPE = "application/pdf"
DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

router = APIRouter(prefix="/api/reports", tags=["Daily Reports"])


@router.get("/{report_date}", response_model=ReportOut)
def get_report(report_date: dt.date, project_id: int | None = None,
               session: Session = Depends(get_session)) -> ReportOut:
    """Bericht eines Tages. Gibt es noch keinen, kommt ein leerer Entwurf (`id: null`) – Status 200.

    Fehler: 404, wenn das Projekt unbekannt ist.
    """
    project = reports.resolve_project(session, project_id)
    return reports.to_out(session, project.id, report_date,
                          reports.find_report(session, project.id, report_date))


@router.put("/{report_date}", response_model=ReportOut)
def put_report(report_date: dt.date, data: ReportIn, project_id: int | None = None,
               session: Session = Depends(get_session)) -> ReportOut:
    """Speichert den Bericht (legt ihn an oder ersetzt ihn).

    Fehler: 404 Projekt unbekannt · 422 ungültige Felder oder Vorgang gehört nicht zum Projekt.
    """
    project = reports.resolve_project(session, project_id)
    return reports.upsert(session, project, report_date, data)


@router.post("/{report_date}/fill", response_model=FillResponse)
async def fill_report(report_date: dt.date, req: FillRequest,
                      session: Session = Depends(get_session)) -> FillResponse:
    """Diktat/Text → Bericht des Tages ergänzen (KI oder Offline-Regeln) + Tagebucheintrag.

    Antwortet auch ohne KI mit 200 (`mode: "offline"`). Fehler: 404 Projekt unbekannt.
    """
    project = reports.resolve_project(session, req.project_id)
    return await reports.fill(session, project, report_date, req)


@router.post("/{report_date}/bullets/remove", response_model=ReportOut)
def remove_report_bullet(report_date: dt.date, req: BulletRemoveRequest,
                         session: Session = Depends(get_session)) -> ReportOut:
    """Entfernt einen kategorisierten Stichpunkt aus der Erfassung und dem Tagesbericht."""
    project = reports.resolve_project(session, req.project_id)
    return reports.remove_bullet(session, project, report_date, req)


async def _export(report_date: dt.date, project_id: int | None, ext: str, session: Session) -> Response:
    """Gemeinsamer Ablauf für PDF und Word: Bericht laden → Exportdaten bauen → rendern → Download."""
    project = reports.resolve_project(session, project_id)
    report = reports.find_report(session, project.id, report_date)
    if report is None:
        # Ein noch nicht gespeicherter (leerer) Tag wird nicht exportiert.
        raise HTTPException(status_code=404, detail=f"Kein Tagesbericht für {report_date:%d.%m.%Y}")
    doc = await report_documents.build(session, project, report)
    try:
        content = report_documents.render_pdf(doc) if ext == "pdf" else report_documents.render_docx(doc)
    except PdfUnavailable as e:
        # 503 = Server kann gerade nicht (Pango fehlt) – Word-Export geht trotzdem.
        raise HTTPException(status_code=503, detail=str(e))
    # Status bleibt unverändert: Ein Tagesbericht bleibt bearbeitbar (anders als ein freigegebener Brief).
    headers = {"Content-Disposition": f'attachment; filename="{report_documents.report_filename(report, ext)}"'}
    return Response(content=content, media_type=PDF_MEDIA_TYPE if ext == "pdf" else DOCX_MEDIA_TYPE, headers=headers)


@router.get("/{report_date}/pdf", response_class=Response,
            responses={200: {"content": {PDF_MEDIA_TYPE: {}}}})
async def export_report_pdf(report_date: dt.date, project_id: int | None = None,
                            session: Session = Depends(get_session)) -> Response:
    """Bautagesbericht als PDF (Contract: GET /api/reports/{date}/pdf).

    Nicht abgeschlossene Berichte tragen das Wasserzeichen "ENTWURF".
    Fehler: 404 Projekt/Bericht unbekannt · 503 PDF-Bibliothek (Pango) fehlt.
    """
    return await _export(report_date, project_id, "pdf", session)


@router.get("/{report_date}/docx", response_class=Response,
            responses={200: {"content": {DOCX_MEDIA_TYPE: {}}}})
async def export_report_docx(report_date: dt.date, project_id: int | None = None,
                             session: Session = Depends(get_session)) -> Response:
    """Bautagesbericht als Word-Datei (Contract: GET /api/reports/{date}/docx). Fehler: 404."""
    return await _export(report_date, project_id, "docx", session)

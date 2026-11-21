"""Router für Baustellenfotos: Hochladen, KI-/Offline-Beschreibung, Auflisten nach Tag/Zeitraum, Bildabruf & Löschen."""

import datetime as dt
import json
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session

from src.database import get_session
from src.models import SitePhoto
from src.schemas.photos import PhotoDescribeResponse, PhotoOut
from src.services import photos as photos_service
from src.services.reports import resolve_project

router = APIRouter(prefix="/api/photos", tags=["Photos"])

MAX_PHOTO_BYTES = 15 * 1024 * 1024  # 15 MB


@router.get("", response_model=list[PhotoOut])
def get_photos(
    project_id: int | None = None,
    date: dt.date | None = None,
    date_from: dt.date | None = Query(None, alias="from"),
    date_to: dt.date | None = Query(None, alias="to"),
    session: Session = Depends(get_session),
) -> list[PhotoOut]:
    """Alle Fotos eines Projekts (optional gefiltert nach einzelnem `date` oder Zeitraum `[from, to]`)."""
    project = resolve_project(session, project_id)
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="'from' liegt nach 'to'")
    return photos_service.list_photos(session, project.id, date_from=date_from, date_to=date_to, exact_date=date)


@router.post("", response_model=PhotoOut, status_code=201)
async def upload_photo(
    file: UploadFile = File(...),
    project_id: int | None = Form(default=None),
    report_date: dt.date | None = Form(default=None),
    caption: str | None = Form(default=None),
    lang: str = Form(default="de"),
    session: Session = Depends(get_session),
) -> PhotoOut:
    """Lädt ein Baustellenfoto zu einem Projekt und Tag hoch, speichert es und erzeugt eine Beschreibung."""
    project = resolve_project(session, project_id)
    target_date = report_date or dt.date.today()
    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="Leere Bilddatei")
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Bilddatei größer als 15 MB")

    safe_name, stored_path = photos_service.save_photo_file(data, file.filename or "photo.jpg")
    mime_type = file.content_type if (file.content_type or "").startswith("image/") else "image/jpeg"
    cap, diary_text, issues, mode = await photos_service.analyze_photo_metadata(
        session, project, safe_name, target_date, caption_hint=caption, lang=lang
    )

    photo = SitePhoto(
        project_id=project.id,
        report_date=target_date,
        file_name=safe_name,
        file_path=str(stored_path),
        mime_type=mime_type,
        caption=cap,
        diary_text=diary_text,
        issues_json=json.dumps(issues, ensure_ascii=False),
        source_mode=mode,
    )
    session.add(photo)
    session.commit()
    session.refresh(photo)
    return photos_service.to_photo_out(photo)


@router.post("/describe", response_model=PhotoDescribeResponse)
async def describe_photo(
    file: UploadFile = File(...),
    project_id: int | None = Form(default=None),
    report_date: dt.date | None = Form(default=None),
    caption: str | None = Form(default=None),
    lang: str = Form(default="de"),
    session: Session = Depends(get_session),
) -> PhotoDescribeResponse:
    """Analysiert ein hochgeladenes Foto und speichert es am Projekt/Kalendertag."""
    project = resolve_project(session, project_id)
    target_date = report_date or dt.date.today()
    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="Leere Bilddatei")
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Bilddatei größer als 15 MB")

    safe_name, stored_path = photos_service.save_photo_file(data, file.filename or "photo.jpg")
    mime_type = file.content_type if (file.content_type or "").startswith("image/") else "image/jpeg"
    cap, diary_text, issues, mode = await photos_service.analyze_photo_metadata(
        session, project, safe_name, target_date, caption_hint=caption, lang=lang
    )

    photo = SitePhoto(
        project_id=project.id,
        report_date=target_date,
        file_name=safe_name,
        file_path=str(stored_path),
        mime_type=mime_type,
        caption=cap,
        diary_text=diary_text,
        issues_json=json.dumps(issues, ensure_ascii=False),
        source_mode=mode,
    )
    session.add(photo)
    session.commit()
    session.refresh(photo)
    out = photos_service.to_photo_out(photo)
    return PhotoDescribeResponse(
        caption=out.caption,
        diary_text=out.diary_text,
        issues=out.issues,
        mode=out.mode,
        id=out.id,
        project_id=out.project_id,
        report_date=out.report_date,
        file_name=out.file_name,
        url=out.url,
        created_at=out.created_at,
    )


@router.get("/{photo_id}/file")
def get_photo_file(photo_id: int, session: Session = Depends(get_session)):
    """Liefert die gespeicherte Bilddatei aus."""
    photo = session.get(SitePhoto, photo_id)
    if photo is None or not photo.file_path:
        raise HTTPException(status_code=404, detail="Foto nicht gefunden")
    path = Path(photo.file_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Fotodatei auf dem Server nicht gefunden")
    return FileResponse(path=path, media_type=photo.mime_type or "image/jpeg", filename=photo.file_name)


@router.delete("/{photo_id}", status_code=204)
def delete_photo(photo_id: int, session: Session = Depends(get_session)) -> Response:
    """Löscht ein Baustellenfoto inklusive der gespeicherten Datei."""
    photo = session.get(SitePhoto, photo_id)
    if photo is None:
        raise HTTPException(status_code=404, detail="Foto nicht gefunden")
    file_path = photo.file_path
    session.delete(photo)
    session.commit()
    photos_service.delete_photo_file(file_path)
    return Response(status_code=204)

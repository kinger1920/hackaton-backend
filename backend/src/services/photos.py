"""Service für Baustellenfotos: Speichern auf der Platte, KI-/Offline-Bildbeschreibung und Verwaltung."""

import datetime as dt
import json
import logging
import re
import uuid
from pathlib import Path
from typing import Literal

from pydantic import BaseModel
from sqlmodel import Session, select

from src.database import UPLOADS_DIR
from src.models import Project, SitePhoto
from src.schemas.photos import PhotoOut
from src.services import llm
from src.services.reports import project_tasks

logger = logging.getLogger(__name__)

PHOTOS_UPLOAD_DIR = UPLOADS_DIR / "photos"
PHOTOS_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _safe_filename(original_name: str) -> str:
    base = Path(original_name or "photo.jpg").name
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", base)
    return cleaned or "photo.jpg"


def save_photo_file(data: bytes, original_name: str) -> tuple[str, Path]:
    """Speichert die hochgeladene Bilddatei unter `data/uploads/photos/`."""
    PHOTOS_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_filename(original_name)
    stored_name = f"{uuid.uuid4().hex}_{safe_name}"
    dest = PHOTOS_UPLOAD_DIR / stored_name
    dest.write_bytes(data)
    return safe_name, dest


def delete_photo_file(file_path: str | None) -> None:
    if not file_path:
        return
    try:
        path = Path(file_path)
        if path.is_file():
            path.unlink()
    except OSError as exc:
        logger.warning("Fotodatei %s konnte nicht gelöscht werden: %s", file_path, exc)


class _LLMPhotoAnalysis(BaseModel):
    caption: str
    diary_text: str
    issues: list[str]


PHOTO_PROMPT = """Du bist ein KI-Assistent für Bauleiter und erstellst aus einer Fotobezeichnung bzw. Notiz zu einem Baustellenfoto:
- caption: Kurzer, präziser Bildtitel (max. 70 Zeichen, z. B. "Bewehrung Decke 1. OG Achse B").
- diary_text: Ein sachlicher Satz für den Bautagesbericht (z. B. "Fotodokumentation: Bewehrung der Decke über 1. OG in Achse B vor Betonage geprüft.").
- issues: Liste erkannter Mängel, Behinderungen oder Sicherheitsrisiken (leer [], wenn kein Problem erkennbar ist).
Antworte auf Deutsch, erfinde keine Mängel, wenn der Kontext nicht darauf hindeutet."""


def _offline_describe(file_name: str, caption_hint: str | None, project: Project | None, report_date: dt.date) -> tuple[str, str, list[str]]:
    """Deterministischer Offline-Fallback für Fotoanalyse anhand von Dateiname / Hinweis."""
    stem = Path(file_name or "Baustellenfoto").stem
    cleaned = re.sub(r"[_\-]+", " ", stem).strip()
    if re.fullmatch(r"(?:IMG|DSC|PHOTO|PXL|whatsapp|image)[\s\d_]*", cleaned, re.IGNORECASE) or not cleaned:
        cleaned = f"Baustellenaufnahme {report_date:%d.%m.%Y}"
    title = (caption_hint or "").strip() or cleaned

    lower = f"{title} {file_name}".lower()
    issues: list[str] = []
    if any(w in lower for w in ("riss", "mangel", "defekt", "schaden", "feucht", "wasser", "rost", "abplatz")):
        issues.append(f"Möglicher Mangel laut Fotodokumentation ({title}) prüfen")
    if any(w in lower for w in ("stillstand", "blockiert", "behinderung", "fehlt", "sperr")):
        issues.append(f"Behinderung / Stillstand dokumentiert ({title})")

    proj_part = f" ({project.name})" if project else ""
    if issues:
        diary_text = f"Fotodokumentation vom {report_date:%d.%m.%Y}: {title} – Auffälligkeit: {'; '.join(issues)}."
    else:
        diary_text = f"Fotodokumentation vom {report_date:%d.%m.%Y}{proj_part}: {title}."
    return title[:120], diary_text, issues


async def analyze_photo_metadata(
    session: Session,
    project: Project | None,
    file_name: str,
    report_date: dt.date,
    caption_hint: str | None = None,
    lang: str = "de",
) -> tuple[str, str, list[str], Literal["ai", "offline"]]:
    """Erzeugt Bildunterschrift, Tagebuchtext und Mängelhinweise (KI mit Offline-Fallback)."""
    tasks_str = ""
    if project is not None:
        tasks = project_tasks(session, project.id)
        if tasks:
            tasks_str = "\nAktuelle Vorgänge im Bauzeitenplan:\n" + "\n".join(
                f"- {t.task_code or t.id}: {t.title} ({t.trade or 'Allgemein'})" for t in tasks[:10]
            )
    user_text = (
        f"Projekt: {project.name if project else 'Baustelle'}\n"
        f"Datum: {report_date:%d.%m.%Y}\n"
        f"Dateiname: {file_name}\n"
        f"Nutzer-Notiz/Titel: {caption_hint or '(keine)'}\n"
        f"Sprache: {lang}{tasks_str}"
    )
    res = await llm.complete_json(PHOTO_PROMPT, user_text, _LLMPhotoAnalysis, max_tokens=400)
    if res is not None and res.caption.strip() and res.diary_text.strip():
        caption = (caption_hint or "").strip() or res.caption.strip()
        return caption, res.diary_text.strip(), [i.strip() for i in res.issues if i.strip()], "ai"

    caption, diary_text, issues = _offline_describe(file_name, caption_hint, project, report_date)
    return caption, diary_text, issues, "offline"


def to_photo_out(photo: SitePhoto) -> PhotoOut:
    try:
        issues = json.loads(photo.issues_json) if photo.issues_json else []
        if not isinstance(issues, list):
            issues = []
    except (ValueError, TypeError):
        issues = []
    mode: Literal["ai", "offline"] = "ai" if photo.source_mode == "ai" else "offline"
    return PhotoOut(
        id=photo.id,  # type: ignore[arg-type]
        project_id=photo.project_id,
        report_date=photo.report_date,
        file_name=photo.file_name,
        mime_type=photo.mime_type or "image/jpeg",
        url=f"/api/photos/{photo.id}/file",
        caption=photo.caption or photo.file_name,
        diary_text=photo.diary_text or "",
        issues=[str(x) for x in issues],
        mode=mode,
        created_at=photo.created_at,
    )


def list_photos(
    session: Session,
    project_id: int,
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
    exact_date: dt.date | None = None,
) -> list[PhotoOut]:
    stmt = select(SitePhoto).where(SitePhoto.project_id == project_id)
    if exact_date is not None:
        stmt = stmt.where(SitePhoto.report_date == exact_date)
    else:
        if date_from is not None:
            stmt = stmt.where(SitePhoto.report_date >= date_from)
        if date_to is not None:
            stmt = stmt.where(SitePhoto.report_date <= date_to)
    rows = list(session.exec(stmt.order_by(SitePhoto.report_date.desc(), SitePhoto.id.desc())).all())
    return [to_photo_out(p) for p in rows]

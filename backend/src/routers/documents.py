"""Endpunkte für Projektdokumente (Besprechungsprotokolle, E-Mails, Tagebucheinträge) und Bauleiter-Profil.

Ersetzt die bisherige reine localStorage-Speicherung (`projectDocuments`, `userProfile`, `userName`).
"""

import datetime as dt
import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlmodel import Session, select

from src.database import get_session
from src.models import Project, ProjectDocument, UserProfile
from src.services.reports import resolve_project

router = APIRouter(prefix="/api", tags=["Documents & Profile"])

DocType = Literal["diary", "minutes", "emails"]


class ProjectDocumentOut(BaseModel):
    id: str
    db_id: int
    projectId: int
    type: DocType
    title: str
    date: str
    authorOrSender: str
    content: str
    weather: str | None = None
    workforceCount: int | None = None
    trades: list[str] | None = None
    hindrance: str | None = None
    summary: dict[str, Any] | None = None


class ProjectDocumentIn(BaseModel):
    id: str | None = None
    projectId: int | str | None = None
    type: DocType = "minutes"
    title: str
    date: str
    authorOrSender: str
    content: str
    weather: str | None = None
    workforceCount: int | None = None
    trades: list[str] | None = None
    hindrance: str | None = None
    summary: dict[str, Any] | None = None


class UserPermissions(BaseModel):
    dailyReports: bool = True
    vobLetters: bool = True
    defectNotices: bool = True
    claims: bool = False


ALLOWED_START_TABS = {
    "/dashboard",
    "/capture/voice",
    "/capture/text",
    "/termin",
    "/reports",
    "/drafts",
    "/summary",
    "/fortschritt",
    "/assistent",
    "/projects",
    "/stammdaten",
}


def _normalize_start_tab(value: str | None) -> str:
    cleaned = (value or "").strip()
    return cleaned if cleaned in ALLOWED_START_TABS else "/dashboard"


class UserProfilePayload(BaseModel):
    fullName: str = "Max Mustermann"
    email: str = "m.mustermann@bau-ag.de"
    phone: str = "+49 170 1234567"
    company: str = "Baupartner AG & Co. KG"
    role: str = "Bauleiter"
    officeLocation: str = "Niederlassung Berlin-Brandenburg"
    workplaceType: str = "Baustellencontainer vor Ort"
    startTab: str = "/dashboard"
    permissions: UserPermissions = UserPermissions()


DEFAULT_MINUTES_AND_EMAILS: list[dict[str, Any]] = [
    {
        "doc_key": "seed-min-1",
        "doc_type": "minutes",
        "title": "Jour Fixe Nr. 18 — Rohbau & TGA Koordination",
        "doc_date": "19.11.2026",
        "author": "Projektleitung / Bauleitung",
        "content": (
            "PROTOKOLL JOUR FIXE NR. 18 — Bauvorhaben Schulzentrum Nord\n"
            "Datum: 19.11.2026, 10:00–11:30 Uhr | Ort: Baustellencontainer\n"
            "Teilnehmer: Bauleitung, Erdbau Krause GmbH, Stahlbeton Weber AG, TGA-Fachplanung\n\n"
            "TOP 1 — Leitungspläne & Aushub Achse B:\n"
            "Die bestätigten Bestandspläne der Gas- und Medienleitung an Achse B stehen seitens des Auftraggebers "
            "weiterhin aus. Der Aushub in Achse B ist dadurch verzögert. Frist zur Planübergabe: 23.11.2026.\n\n"
            "TOP 2 — Personalstärke Erdbau Krause:\n"
            "Die Bauleitung weist darauf hin, dass vertraglich 3 Fachkräfte vereinbart sind, zuletzt jedoch nur "
            "1–2 Personen vor Ort waren. Fa. Krause sagt Aufstockung auf Sollstärke ab Wochenbeginn zu.\n\n"
            "TOP 3 — Bewehrungsabnahme & Betonage:\n"
            "Abnahme der Deckenbewehrung durch Prüfstatiker Dr. Lang wird für den 24.11.2026 um 14:00 Uhr terminiert."
        ),
    },
    {
        "doc_key": "seed-mail-1",
        "doc_type": "emails",
        "title": "E-Mail: Fehlende TGA-Schlitz- und Durchbruchspläne Schacht 3",
        "doc_date": "18.11.2026",
        "author": "Stahlbeton Weber AG <bauleitung@weber-rohbau.de>",
        "content": (
            "Von: Stahlbeton Weber AG <bauleitung@weber-rohbau.de>\n"
            "An: Bauleitung <m.mustermann@bau-ag.de>\n"
            "Datum: 18.11.2026, 15:40 Uhr\n"
            "Betreff: Dringend: Fehlende TGA-Freigabepläne Schacht 3 / Decke 1. OG\n\n"
            "Sehr geehrter Herr Mustermann,\n"
            "für die Schalungs- und Bewehrungsarbeiten im Bereich Schacht 3 liegen uns noch immer keine "
            "freigegebenen Aussparungsangaben der TGA-Planung vor. Ohne Freigabe bis morgen 12:00 Uhr "
            "müssen wir den Takt unterbrechen und melden vorsorglich Behinderung nach § 6 Abs. 1 VOB/B an."
        ),
    },
]


def _seed_defaults_if_empty(session: Session, project: Project) -> None:
    existing = session.exec(select(ProjectDocument).where(ProjectDocument.project_id == project.id)).first()
    if existing is not None:
        return
    for item in DEFAULT_MINUTES_AND_EMAILS:
        session.add(
            ProjectDocument(
                project_id=project.id,
                doc_key=f"{item['doc_key']}-p{project.id}",
                doc_type=item["doc_type"],
                title=item["title"],
                doc_date=item["doc_date"],
                author=item["author"],
                content=item["content"],
            )
        )
    session.commit()


def _to_doc_out(row: ProjectDocument) -> ProjectDocumentOut:
    trades = None
    if row.trades_json:
        try:
            trades = json.loads(row.trades_json)
        except Exception:
            trades = None
    summary = None
    if row.summary_json:
        try:
            summary = json.loads(row.summary_json)
        except Exception:
            summary = None
    return ProjectDocumentOut(
        id=row.doc_key or f"doc-{row.id}",
        db_id=row.id,  # type: ignore[arg-type]
        projectId=row.project_id,
        type=row.doc_type,  # type: ignore[arg-type]
        title=row.title,
        date=row.doc_date,
        authorOrSender=row.author,
        content=row.content,
        weather=row.weather,
        workforceCount=row.workforce_count,
        trades=trades,
        hindrance=row.hindrance,
        summary=summary,
    )


def _parse_project_id(val: int | str | None) -> int | None:
    if val is None:
        return None
    if isinstance(val, int):
        return val
    s = str(val).replace("proj-", "").strip()
    return int(s) if s.isdigit() else None


@router.get("/documents", response_model=list[ProjectDocumentOut])
def list_documents(
    project_id: int | None = None,
    doc_type: DocType | None = None,
    session: Session = Depends(get_session),
) -> list[ProjectDocumentOut]:
    """Alle gespeicherten Projektdokumente (Protokolle, E-Mails, Tagebuch-Fallback). Seedet Standard-Dokumente bei leerem Projekt."""
    project = resolve_project(session, project_id)
    _seed_defaults_if_empty(session, project)
    stmt = select(ProjectDocument).where(ProjectDocument.project_id == project.id)
    if doc_type is not None:
        stmt = stmt.where(ProjectDocument.doc_type == doc_type)
    rows = list(session.exec(stmt.order_by(ProjectDocument.id.desc())).all())
    return [_to_doc_out(r) for r in rows]


@router.post("/documents", response_model=ProjectDocumentOut, status_code=201)
def create_or_update_document(
    payload: ProjectDocumentIn,
    session: Session = Depends(get_session),
) -> ProjectDocumentOut:
    """Speichert oder aktualisiert ein Projektdokument im Backend."""
    pid = _parse_project_id(payload.projectId)
    project = resolve_project(session, pid)
    existing = None
    if payload.id:
        existing = session.exec(
            select(ProjectDocument).where(
                ProjectDocument.project_id == project.id,
                ProjectDocument.doc_key == payload.id,
            )
        ).first()
    row = existing or ProjectDocument(project_id=project.id, doc_key=payload.id)
    row.doc_type = payload.type
    row.title = payload.title
    row.doc_date = payload.date
    row.author = payload.authorOrSender
    row.content = payload.content
    row.weather = payload.weather
    row.workforce_count = payload.workforceCount
    row.trades_json = json.dumps(payload.trades, ensure_ascii=False) if payload.trades is not None else None
    row.hindrance = payload.hindrance
    row.summary_json = json.dumps(payload.summary, ensure_ascii=False) if payload.summary is not None else None
    session.add(row)
    session.commit()
    session.refresh(row)
    if not row.doc_key:
        row.doc_key = f"doc-{row.id}"
        session.add(row)
        session.commit()
        session.refresh(row)
    return _to_doc_out(row)


@router.delete("/documents/{doc_id}", status_code=204)
def delete_document(doc_id: str, session: Session = Depends(get_session)) -> Response:
    """Löscht ein Projektdokument anhand seiner ID oder seines doc_key."""
    row = None
    if doc_id.isdigit():
        row = session.get(ProjectDocument, int(doc_id))
    if row is None:
        row = session.exec(select(ProjectDocument).where(ProjectDocument.doc_key == doc_id)).first()
    if row is None and doc_id.startswith("doc-") and doc_id[4:].isdigit():
        row = session.get(ProjectDocument, int(doc_id[4:]))
    if row is None:
        raise HTTPException(status_code=404, detail="Dokument nicht gefunden")
    session.delete(row)
    session.commit()
    return Response(status_code=204)


def _get_or_create_profile(session: Session) -> UserProfile:
    prof = session.exec(select(UserProfile).order_by(UserProfile.id)).first()
    if prof is None:
        prof = UserProfile()
        session.add(prof)
        session.commit()
        session.refresh(prof)
    return prof


def _to_profile_payload(prof: UserProfile) -> UserProfilePayload:
    try:
        perms = UserPermissions(**json.loads(prof.permissions_json or "{}"))
    except Exception:
        perms = UserPermissions()
    return UserProfilePayload(
        fullName=prof.full_name,
        email=prof.email,
        phone=prof.phone,
        company=prof.company,
        role=prof.role,
        officeLocation=prof.office_location,
        workplaceType=prof.workplace_type,
        startTab=_normalize_start_tab(prof.start_tab),
        permissions=perms,
    )


@router.get("/profile", response_model=UserProfilePayload)
def get_profile(session: Session = Depends(get_session)) -> UserProfilePayload:
    """Lädt das gespeicherte Bauleiter-Profil."""
    return _to_profile_payload(_get_or_create_profile(session))


@router.put("/profile", response_model=UserProfilePayload)
def put_profile(payload: UserProfilePayload, session: Session = Depends(get_session)) -> UserProfilePayload:
    """Speichert das Bauleiter-Profil in der Datenbank."""
    prof = _get_or_create_profile(session)
    prof.full_name = payload.fullName.strip() or "Max Mustermann"
    prof.email = payload.email.strip()
    prof.phone = payload.phone.strip()
    prof.company = payload.company.strip()
    prof.role = payload.role.strip() or "Bauleiter"
    prof.office_location = payload.officeLocation.strip()
    prof.workplace_type = payload.workplaceType.strip()
    prof.start_tab = _normalize_start_tab(payload.startTab)
    prof.permissions_json = json.dumps(payload.permissions.model_dump(), ensure_ascii=False)
    prof.updated_at = dt.datetime.now(dt.timezone.utc)
    session.add(prof)
    session.commit()
    session.refresh(prof)
    return _to_profile_payload(prof)

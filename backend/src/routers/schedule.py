"""Tagesaufgaben/Termine (Zukunft), manuelle Termine (CRUD), iCal-Feed und Timeline (Vergangenheit) eines Projekts.

GET /api/schedule         – Tagesaufgaben + zusammengeführte Termine (manuell + automatisch)
GET /api/schedule/ics     – Live-iCalendar-Feed (.ics) aller Projekttermine für Outlook/Google/Apple
GET /api/timeline         – Timeline: Berichte, Notizen, Briefe, Fortschritt, Warnungen
GET/POST /api/appointments & PATCH/DELETE /api/appointments/{id} – Manuelle Termine
"""

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlmodel import Session

from src.database import get_session
from src.models import Appointment
from src.schemas.schedule import AppointmentCreate, AppointmentUpdate, Schedule, SiteAppointment
from src.schemas.timeline import TIMELINE_TYPES, Timeline
from src.services import schedule as schedule_service
from src.services import timeline as timeline_service
from src.services.reports import resolve_project

router = APIRouter(prefix="/api", tags=["Schedule & Timeline"])

MAX_RANGE_DAYS = 92


@router.get("/schedule", response_model=Schedule)
def get_schedule(project_id: int | None = None, date_from: dt.date | None = Query(None, alias="from"),
                 days: int = Query(7, ge=1, le=31), ref_date: dt.date | None = None,
                 session: Session = Depends(get_session)) -> Schedule:
    """Aufgaben je Werktag + Termine im SiteAppointment-Format (manuelle + automatisch abgeleitete).

    Input: `from` (Default: ref_date bzw. heute), `days` 1–31, `ref_date` = Stand des Ist-Fortschritts.
    Fehler: 404 Projekt unbekannt · 422 ungültige Parameter (FastAPI).
    """
    project = resolve_project(session, project_id)
    ref = ref_date or dt.date.today()
    return schedule_service.schedule(session, project, date_from or ref, days, ref)


@router.get("/schedule/ics", response_class=Response)
def get_schedule_ics(
    project_id: int | None = None,
    ref_date: dt.date | None = None,
    session: Session = Depends(get_session),
) -> Response:
    """Liefert alle Projekttermine (manuell + Bauzeitenplan + Fristen) als iCalendar-Stream (.ics)."""
    project = resolve_project(session, project_id)
    ref = ref_date or dt.date.today()
    content = schedule_service.render_project_ics(session, project, ref)
    filename = f"Termine_Projekt_{project.number or project.id}.ics"
    return Response(
        content=content,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/appointments", response_model=list[SiteAppointment])
def list_appointments(
    project_id: int | None = None,
    date_from: dt.date | None = Query(None, alias="from"),
    date_to: dt.date | None = Query(None, alias="to"),
    session: Session = Depends(get_session),
) -> list[SiteAppointment]:
    """Alle manuell angelegten Termine eines Projekts (optional nach Zeitraum gefiltert)."""
    project = resolve_project(session, project_id)
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="'from' liegt nach 'to'")
    return schedule_service.list_manual_appointments(session, project, date_from, date_to)


@router.post("/appointments", response_model=SiteAppointment, status_code=201)
def create_appointment(
    payload: AppointmentCreate,
    session: Session = Depends(get_session),
) -> SiteAppointment:
    """Neuen manuellen Termin anlegen."""
    project = resolve_project(session, payload.projectId)
    appt = Appointment(
        project_id=project.id,
        title=payload.title,
        date=payload.date,
        time=payload.time,
        category=payload.category,
        trade=payload.trade,
        description=payload.description,
        vob_reference=payload.vobReference,
        is_urgent=payload.isUrgent,
    )
    session.add(appt)
    session.commit()
    session.refresh(appt)
    return schedule_service.appointment_to_schema(appt)


@router.patch("/appointments/{appointment_id}", response_model=SiteAppointment)
def update_appointment(
    appointment_id: int,
    payload: AppointmentUpdate,
    session: Session = Depends(get_session),
) -> SiteAppointment:
    """Bestehenden manuellen Termin bearbeiten."""
    appt = session.get(Appointment, appointment_id)
    if appt is None:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden")
    data = payload.model_dump(exclude_unset=True)
    field_map = {
        "title": "title",
        "date": "date",
        "time": "time",
        "category": "category",
        "trade": "trade",
        "description": "description",
        "vobReference": "vob_reference",
        "isUrgent": "is_urgent",
    }
    for key, attr in field_map.items():
        if key in data:
            setattr(appt, attr, data[key])
    appt.updated_at = dt.datetime.now(dt.timezone.utc)
    session.add(appt)
    session.commit()
    session.refresh(appt)
    return schedule_service.appointment_to_schema(appt)


@router.delete("/appointments/{appointment_id}", status_code=204)
def delete_appointment(
    appointment_id: int,
    session: Session = Depends(get_session),
) -> Response:
    """Manuellen Termin löschen."""
    appt = session.get(Appointment, appointment_id)
    if appt is None:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden")
    session.delete(appt)
    session.commit()
    return Response(status_code=204)


@router.get("/timeline", response_model=Timeline)
def get_timeline(project_id: int | None = None, date_from: dt.date | None = Query(None, alias="from"),
                 date_to: dt.date | None = Query(None, alias="to"),
                 types: str = Query(",".join(TIMELINE_TYPES), description="Kommagetrennt: " + ", ".join(TIMELINE_TYPES)),
                 session: Session = Depends(get_session)) -> Timeline:
    """Ereignisse der Baustelle, neueste zuerst. Default: letzte 14 Tage bis heute.

    Fehler: 404 Projekt unbekannt · 422 from > to, Zeitraum > 92 Tage oder unbekannter Typ.
    """
    project = resolve_project(session, project_id)
    end = date_to or dt.date.today()
    start = date_from or end - dt.timedelta(days=13)
    wanted = [t.strip() for t in types.split(",") if t.strip()]
    unknown = sorted(set(wanted) - set(TIMELINE_TYPES))
    # 422: formal gültige Anfrage, aber unsinnige Werte – lieber klar ablehnen als still ignorieren.
    if unknown:
        raise HTTPException(status_code=422, detail={"unknown_types": unknown})
    if start > end:
        raise HTTPException(status_code=422, detail="'from' liegt nach 'to'")
    if (end - start).days >= MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail=f"Zeitraum maximal {MAX_RANGE_DAYS} Tage")
    return timeline_service.timeline(session, project, start, end, wanted or list(TIMELINE_TYPES))

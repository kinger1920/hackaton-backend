"""Demo-Reset (Contract: POST /api/demo/reset → {ok}) – setzt die Jury-Demo auf einen festen Stand."""

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from src.config import settings
from src.database import get_session
from src.services import demo

router = APIRouter(prefix="/api/demo", tags=["Demo"])


@router.post("/reset")
def reset_demo(ref_date: dt.date | None = None, session: Session = Depends(get_session)) -> dict:
    """Löscht ALLE Daten und lädt den Demo-Stand (Projekt, Firmen/Verträge, Plan, Berichte, Diktate).

    `ref_date` (Default: heute): Der letzte Demo-Bericht liegt auf dem letzten Werktag davor.
    Output: {ok, project_id, reports, contracts, tasks, notes, last_report_date, shifted_workdays}.
    Fehler: 403, wenn DEMO_RESET_ENABLED=false (Schutz für Server mit echten Daten).
    """
    if not settings.demo_reset_enabled:
        # 403 = verboten: Die Funktion ist auf diesem Server bewusst abgeschaltet.
        raise HTTPException(status_code=403, detail="Demo-Reset ist deaktiviert (DEMO_RESET_ENABLED=false)")
    return demo.reset(session, ref_date or dt.date.today())

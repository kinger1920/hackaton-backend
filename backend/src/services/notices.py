"""Fachlogik für Brief-Entwürfe: anlegen, bearbeiten, Pflichtfeld-Prüfung, Freigabe.

Human in the loop: Ein Entwurf wird nur freigegeben, wenn alle Pflichtangaben da sind
und kein "[fehlt: …]"-Platzhalter mehr im Text steht. Nach der Freigabe ist er gesperrt.
Die Router übersetzen die Exceptions hier in HTTP-Statuscodes (409).
"""

import datetime as dt
import json

from sqlmodel import Session, select

from src.config import settings
from src.models import FormalNotice, NoticeDraftData, Project
from src.schemas.ai import NoticeDraft, SourcedField
from src.schemas.notices import NoticeDispatch, NoticeOut, NoticePatch
from src.services import letters
from src.services.extraction import QUESTIONS, REQUIRED_FIELDS

STATUS_DRAFT = "Entwurf"
STATUS_APPROVED = "Freigegeben"
STATUS_EXPORTED = "Exportiert"


class NoticeLocked(Exception):
    """Entwurf ist nicht mehr im Status "Entwurf" (bereits freigegeben/exportiert)."""


class NotApproved(Exception):
    """Export verlangt einen freigegebenen Brief."""


class MissingFields(Exception):
    """Freigabe nicht möglich: Pflichtangaben fehlen."""

    def __init__(self, missing: list[str], questions: list[str]):
        super().__init__(", ".join(missing))
        self.missing = missing
        self.questions = questions


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _load_fields(data: NoticeDraftData) -> dict[str, SourcedField]:
    return {k: SourcedField(**v) for k, v in json.loads(data.fields_json or "{}").items()}


def _store_fields(data: NoticeDraftData, fields: dict[str, SourcedField]) -> None:
    data.fields_json = json.dumps({k: v.model_dump() for k, v in fields.items()}, ensure_ascii=False)


def get_data(session: Session, notice: FormalNotice) -> NoticeDraftData:
    """Zusatzdaten zum Brief laden. Fehlen sie (z. B. Brief über anderen Weg angelegt), leer anlegen."""
    data = session.exec(select(NoticeDraftData).where(NoticeDraftData.notice_id == notice.id)).first()
    if data is None:
        data = NoticeDraftData(notice_id=notice.id)
        session.add(data)
    return data


def required_for(notice_type: str) -> list[str]:
    """Pflichtfelder für die Freigabe: die der Extraktion + Empfänger (ein Brief braucht einen Adressaten)."""
    return ["recipient", *REQUIRED_FIELDS.get(notice_type, [])]


def missing_fields(notice: FormalNotice, fields: dict[str, SourcedField]) -> tuple[list[str], list[str]]:
    """Liefert (fehlende Pflichtfelder, Rückfragen) – deterministisch, ohne KI."""
    missing = [
        name
        for name in required_for(notice.type)
        if not fields.get(name, SourcedField()).value.strip() and not (name == "recipient" and notice.recipient)
    ]
    questions = [QUESTIONS.get(name, f"Bitte '{name}' ergänzen.") for name in missing]
    # Auch ein manuell bearbeiteter Text darf keine Platzhalter mehr enthalten.
    if letters.PLACEHOLDER_PREFIX in (notice.body or "") and not missing:
        missing.append("body")
        questions.append("Im Brieftext stehen noch Platzhalter „[fehlt: …]“ – bitte ergänzen.")
    return missing, questions


def to_out(notice: FormalNotice, data: NoticeDraftData) -> NoticeOut:
    """FormalNotice + Zusatzdaten → API-Antwort."""
    fields = _load_fields(data)
    missing, questions = missing_fields(notice, fields)
    return NoticeOut(
        **notice.model_dump(),
        fields=fields,
        missing_fields=missing,
        questions=questions,
        approved_by=data.approved_by,
        approved_at=data.approved_at,
    )


def create_from_draft(
    session: Session, project: Project, draft: NoticeDraft, site_note_id: int | None
) -> tuple[FormalNotice, NoticeDraftData]:
    """Legt aus dem /capture-Ergebnis einen gespeicherten Brief-Entwurf an.

    Empfänger: aus dem Diktat; sonst der Bauherr des Projekts (Quelle "regel").
    """
    fields = dict(draft.fields)
    if not fields.get("recipient", SourcedField()).value and project.client:
        fields["recipient"] = SourcedField(value=project.client, src="regel")

    subject, body = letters.render(draft.type, fields, project)
    notice = FormalNotice(
        project_id=project.id,
        type=draft.type,
        title=letters.title_for(draft.type, fields),
        recipient=fields.get("recipient", SourcedField()).value or None,
        subject=subject,
        body=body,
        # Nachvollziehbarkeit: aus welchem Tagebucheintrag stammt der Brief?
        source_references=json.dumps({"site_note_ids": [site_note_id]}) if site_note_id else None,
    )
    session.add(notice)
    session.flush()  # vergibt notice.id, ohne schon zu committen

    data = NoticeDraftData(notice_id=notice.id)
    _store_fields(data, fields)
    session.add(data)
    session.commit()
    session.refresh(notice)
    session.refresh(data)
    return notice, data


def apply_patch(session: Session, notice: FormalNotice, data: NoticeDraftData, patch: NoticePatch) -> None:
    """Übernimmt Änderungen des Bauleiters.

    Felder → Quelle "nutzer", danach Betreff/Text neu aus der Vorlage (außer subject/body
    werden explizit mitgeschickt – dann gilt der manuell bearbeitete Text).
    Fehler: NoticeLocked, wenn der Brief schon freigegeben ist.
    """
    if notice.status != STATUS_DRAFT:
        raise NoticeLocked()

    fields = _load_fields(data)
    changed = False
    updates = dict(patch.fields or {})
    if patch.recipient is not None:
        updates["recipient"] = patch.recipient
    for name, value in updates.items():
        if value.strip():
            fields[name] = SourcedField(value=value.strip(), src="nutzer")
        else:
            fields.pop(name, None)  # leerer Wert = Feld löschen
        changed = True

    if changed:
        _store_fields(data, fields)
        notice.recipient = fields.get("recipient", SourcedField()).value or None
        notice.title = letters.title_for(notice.type, fields)
        project = session.get(Project, notice.project_id)
        subject, body = letters.render(notice.type, fields, project)
        notice.subject, notice.body = subject, body

    # Manuell bearbeiteter Text hat Vorrang vor der Vorlage.
    if patch.subject is not None:
        notice.subject = patch.subject
    if patch.body is not None:
        notice.body = patch.body

    notice.updated_at = _now()
    session.add(notice)
    session.add(data)
    session.commit()
    session.refresh(notice)
    session.refresh(data)


def approve(session: Session, notice: FormalNotice, data: NoticeDraftData) -> None:
    """Gibt den Entwurf frei und protokolliert wer/wann (Audit).

    Fehler: NoticeLocked (schon freigegeben), MissingFields (Pflichtangaben fehlen).
    """
    if notice.status != STATUS_DRAFT:
        raise NoticeLocked()
    missing, questions = missing_fields(notice, _load_fields(data))
    if missing:
        raise MissingFields(missing, questions)

    notice.status = STATUS_APPROVED
    notice.updated_at = _now()
    data.approved_by = settings.demo_user_name
    data.approved_at = _now()
    session.add(notice)
    session.add(data)
    session.commit()
    session.refresh(notice)
    session.refresh(data)


def mark_exported(session: Session, notice: FormalNotice) -> None:
    """Prüft vor dem Export die Freigabe und setzt den Status auf "Exportiert".

    Fehler: NotApproved, wenn der Brief noch ein Entwurf ist ("nichts ohne Freigabe").
    Ein schon exportierter Brief darf erneut heruntergeladen werden.
    """
    if notice.status not in (STATUS_APPROVED, STATUS_EXPORTED):
        raise NotApproved()
    if notice.status != STATUS_EXPORTED:
        notice.status = STATUS_EXPORTED
        notice.updated_at = _now()
        session.add(notice)
        session.commit()
        session.refresh(notice)


def list_notices(session: Session, project_id: int | None) -> list[tuple[FormalNotice, NoticeDraftData]]:
    """Alle Briefe (optional je Projekt), neueste zuerst."""
    stmt = select(FormalNotice).order_by(FormalNotice.id.desc())
    if project_id is not None:
        stmt = stmt.where(FormalNotice.project_id == project_id)
    return [(n, get_data(session, n)) for n in session.exec(stmt).all()]


def get_dispatch(data: NoticeDraftData) -> NoticeDispatch | None:
    if not data.dispatch_json:
        return None
    try:
        return NoticeDispatch(**json.loads(data.dispatch_json))
    except Exception:
        return None


def save_dispatch(session: Session, notice: FormalNotice, data: NoticeDraftData, dispatch: NoticeDispatch) -> NoticeDispatch:
    data.dispatch_json = json.dumps(dispatch.model_dump(), ensure_ascii=False)
    notice.updated_at = _now()
    session.add(data)
    session.add(notice)
    session.commit()
    session.refresh(data)
    return dispatch


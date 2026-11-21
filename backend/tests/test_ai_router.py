"""Endpunkt-Tests für POST /api/capture (Projektzuordnung des Tagebucheintrags).

Laufen offline: eigene In-Memory-Datenbank statt `site_assistant.db`, kein KI-Aufruf
(der Groq-Client wird abgeschaltet → Offline-Regeln).
"""

from sqlmodel import Session

from src.models import Project, SiteNote


def _add_projects(engine, *names: str) -> list[int]:
    with Session(engine) as s:
        projects = [Project(name=n) for n in names]
        s.add_all(projects)
        s.commit()
        return [p.id for p in projects]


def _note(engine, note_id: int) -> SiteNote:
    with Session(engine) as s:
        return s.get(SiteNote, note_id)


def test_capture_uses_given_project(client, engine):
    _, second = _add_projects(engine, "A", "B")
    r = client.post("/api/capture", json={"text": "Bagger steht seit 10 Uhr.", "project_id": second})
    assert r.status_code == 200
    assert _note(engine, r.json()["site_note_id"]).project_id == second


def test_capture_without_project_id_uses_first_project(client, engine):
    first, _ = _add_projects(engine, "A", "B")
    r = client.post("/api/capture", json={"text": "Bagger steht seit 10 Uhr."})
    assert r.status_code == 200
    assert _note(engine, r.json()["site_note_id"]).project_id == first


def test_capture_unknown_project_returns_404(client, engine):
    _add_projects(engine, "A")
    r = client.post("/api/capture", json={"text": "Bagger steht.", "project_id": 999})
    assert r.status_code == 404


def test_capture_without_any_project_still_returns_draft(client):
    r = client.post("/api/capture", json={"text": "Bagger steht."})
    assert r.status_code == 200
    assert r.json()["site_note_id"] is None
    assert r.json()["mode"] == "offline"

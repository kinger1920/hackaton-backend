"""Tests für Smart Drafts: Brief anlegen (/capture), bearbeiten (PATCH), freigeben (/approve).

Laufen offline mit In-Memory-DB (Fixtures in conftest.py) – die Extraktion nutzt also
die Offline-Regeln, deshalb fehlen nach /capture typischerweise Ort und Ursache.
"""

import pytest
from sqlmodel import Session

from src.models import Project
from src.schemas.ai import SourcedField
from src.services import letters

DICTATION = "Bagger steht seit 10 Uhr, Leitungspläne fehlen."


def _project(engine, client_name: str | None = "Stadt Berlin") -> int:
    with Session(engine) as s:
        p = Project(name="Neubau Nord", number="PRJ-1", client=client_name)
        s.add(p)
        s.commit()
        return p.id


def _capture(client, project_id: int) -> int:
    r = client.post("/api/capture", json={"text": DICTATION, "project_id": project_id, "ref_date": "2026-11-21"})
    assert r.status_code == 200
    notice_id = r.json()["notice_id"]
    assert notice_id is not None
    return notice_id


def test_capture_creates_notice_with_template_text(client, engine):
    notice_id = _capture(client, _project(engine))
    n = client.get(f"/api/notices/{notice_id}").json()
    assert n["type"] == "delay"
    assert n["status"] == "Entwurf"
    assert "§ 6 Abs. 1 VOB/B" in n["body"]
    assert '"Neubau Nord" (Projekt-Nr. PRJ-1)' in n["body"]
    # Empfänger fehlt im Diktat → Bauherr des Projekts als Regel-Wert
    assert n["recipient"] == "Stadt Berlin"
    assert n["fields"]["recipient"]["src"] == "regel"
    # Offline fehlen Ort und Ursache → sichtbare Platzhalter + missing_fields
    assert "[fehlt: Ort]" in n["body"]
    assert set(n["missing_fields"]) >= {"location", "cause"}


def test_approve_with_missing_fields_returns_409(client, engine):
    notice_id = _capture(client, _project(engine))
    r = client.post(f"/api/notices/{notice_id}/approve")
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert "location" in detail["missing_fields"]
    assert any("Wo genau" in q for q in detail["questions"])
    # Status bleibt Entwurf
    assert client.get(f"/api/notices/{notice_id}").json()["status"] == "Entwurf"


def test_patch_then_approve_sets_audit(client, engine):
    notice_id = _capture(client, _project(engine))
    r = client.patch(
        f"/api/notices/{notice_id}",
        json={"fields": {"location": "Baugrube Achse B", "cause": "Fehlende Leitungspläne vom Bauherrn"}},
    )
    assert r.status_code == 200
    n = r.json()
    assert n["fields"]["location"] == {"value": "Baugrube Achse B", "src": "nutzer"}
    assert "[fehlt:" not in n["body"]
    assert "Ort: Baugrube Achse B" in n["body"]
    assert n["missing_fields"] == []

    r = client.post(f"/api/notices/{notice_id}/approve")
    assert r.status_code == 200
    n = r.json()
    assert n["status"] == "Freigegeben"
    assert n["approved_by"] == "Bauleiter"
    assert n["approved_at"] is not None


def test_approved_notice_is_locked(client, engine):
    notice_id = _capture(client, _project(engine))
    client.patch(f"/api/notices/{notice_id}", json={"fields": {"location": "Achse B", "cause": "Pläne fehlen"}})
    assert client.post(f"/api/notices/{notice_id}/approve").status_code == 200
    assert client.patch(f"/api/notices/{notice_id}", json={"body": "geändert"}).status_code == 409
    assert client.post(f"/api/notices/{notice_id}/approve").status_code == 409


def test_manual_body_with_placeholder_blocks_approve(client, engine):
    notice_id = _capture(client, _project(engine))
    client.patch(f"/api/notices/{notice_id}", json={"fields": {"location": "Achse B", "cause": "Pläne fehlen"}})
    client.patch(f"/api/notices/{notice_id}", json={"body": "Text mit [fehlt: Datum] drin"})
    r = client.post(f"/api/notices/{notice_id}/approve")
    assert r.status_code == 409
    assert r.json()["detail"]["missing_fields"] == ["body"]


def test_missing_recipient_blocks_approve(client, engine):
    notice_id = _capture(client, _project(engine, client_name=None))
    client.patch(f"/api/notices/{notice_id}", json={"fields": {"location": "Achse B", "cause": "Pläne fehlen"}})
    r = client.post(f"/api/notices/{notice_id}/approve")
    assert r.status_code == 409
    assert r.json()["detail"]["missing_fields"] == ["recipient"]


def test_list_filters_by_project(client, engine):
    p1, p2 = _project(engine), _project(engine)
    _capture(client, p1)
    _capture(client, p2)
    assert len(client.get("/api/notices").json()) == 2
    assert [n["project_id"] for n in client.get(f"/api/notices?project_id={p2}").json()] == [p2]


@pytest.mark.parametrize("path", ["/api/notices/999", "/api/notices/999/approve"])
def test_unknown_notice_404(client, path):
    r = client.get(path) if path.endswith("999") else client.post(path)
    assert r.status_code == 404


FULL_FIELDS = {
    name: SourcedField(value=value, src="ki")
    for name, value in {
        "recipient": "Stadt Berlin",
        "facts": "Bagger steht.",
        "cause": "Pläne fehlen",
        "location": "Achse B",
        "start_date": "2026-11-21",
        "deadline": "2026-11-28",
    }.items()
}


@pytest.mark.parametrize(
    "notice_type,paragraph",
    [("delay", "§ 6 Abs. 1 VOB/B"), ("cost", "§ 2 Abs. 5"), ("defect", "§ 4 Abs. 7"), ("concern", "§ 4 Abs. 3")],
)
def test_render_all_types(notice_type, paragraph):
    project = Project(name="Neubau Nord", number="PRJ-1")
    subject, body = letters.render(notice_type, FULL_FIELDS, project)
    assert paragraph in subject or paragraph in body
    assert "[fehlt:" not in body
    assert "Bauleiter" in body  # Signatur


def test_render_formats_dates_german():
    _, body = letters.render("defect", FULL_FIELDS, Project(name="X"))
    assert "28.11.2026" in body

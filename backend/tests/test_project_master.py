"""Tests: Projekt-Stammdaten + Firmenliste aus Jues Projektformular → Firmen + Verträge (Sollstärke)."""

import datetime as dt
import importlib.util
from pathlib import Path

from sqlmodel import Session, select

from src.models import Company, Contract, Project
from src.services.workforce import workforce_check

_SEED = Path(__file__).resolve().parent.parent / "scripts" / "seed_reports.py"
_spec = importlib.util.spec_from_file_location("seed_reports", _SEED)
seed_reports = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seed_reports)

# Genau so, wie frontend/src/projects/Projects.tsx es schickt (leere Felder als "").
JUE_PAYLOAD = {
    "name": "Neubau Kita Süd", "number": "PRJ-2026-201", "client": "Stadt Berlin", "location": "Berlin",
    "phase": "Rohbau", "status": "Aktiv", "description": "",
    "construction_volume_eur": 4_200_000, "budget_eur": 3_900_000, "gross_floor_area_m2": 1850,
    "gross_volume_m3": None, "construction_type": "Massivbau",
    "start_date": "2026-11-02", "end_date": "", "contract_type": "Einheitspreisvertrag",
    "vob_b_agreed": True, "vob_notes": "Behinderungen binnen 2 AT anzeigen.",
    "contractors": [
        {"name": "Erdbau Krause GmbH", "trade": "Erdbau", "required_workers": 3, "phone": "030 123"},
        {"name": "BetonTech Rohbau GmbH", "trade": "Rohbau", "required_workers": 8, "phone": ""},
    ],
}


def test_create_stores_master_data_and_contractors(client, engine):
    r = client.post("/projects", json=JUE_PAYLOAD)
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["construction_volume_eur"] == 4_200_000 and p["construction_type"] == "Massivbau"
    assert p["start_date"] == "2026-11-02" and p["end_date"] is None and p["vob_b_agreed"] is True
    assert [(c["name"], c["required_workers"], c["phone"]) for c in p["contractors"]] == [
        ("Erdbau Krause GmbH", 3, "030 123"), ("BetonTech Rohbau GmbH", 8, "")]
    with Session(engine) as s:
        contracts = s.exec(select(Contract).where(Contract.project_id == p["id"])).all()
        assert {(c.contractor_name, c.trade, c.planned_workforce) for c in contracts} == {
            ("Erdbau Krause GmbH", "Erdbau", 3), ("BetonTech Rohbau GmbH", "Rohbau", 8)}
        assert len(s.exec(select(Company)).all()) == 2


def test_patch_without_contractors_keeps_them_and_update_has_no_duplicates(client, engine):
    pid = client.post("/projects", json=JUE_PAYLOAD).json()["id"]
    p = client.patch(f"/projects/{pid}", json={"budget_eur": 4_000_000}).json()
    assert p["budget_eur"] == 4_000_000 and len(p["contractors"]) == 2
    changed = [{**JUE_PAYLOAD["contractors"][0], "required_workers": 5}, JUE_PAYLOAD["contractors"][1]]
    p = client.patch(f"/projects/{pid}", json={"contractors": changed}).json()
    assert [c["required_workers"] for c in p["contractors"]] == [5, 8]
    with Session(engine) as s:
        assert len(s.exec(select(Contract).where(Contract.project_id == pid)).all()) == 2


def test_list_and_get_include_contractors(client):
    pid = client.post("/projects", json=JUE_PAYLOAD).json()["id"]
    assert len(client.get(f"/projects/{pid}").json()["contractors"]) == 2
    assert any(len(p["contractors"]) == 2 for p in client.get("/projects").json())


def test_invalid_dates_and_numbers_are_422(client):
    assert client.post("/projects", json={**JUE_PAYLOAD, "end_date": "2026-01-01"}).status_code == 422
    assert client.post("/projects", json={**JUE_PAYLOAD, "budget_eur": -5}).status_code == 422
    pid = client.post("/projects", json=JUE_PAYLOAD).json()["id"]
    assert client.patch(f"/projects/{pid}", json={"end_date": "2026-10-01"}).status_code == 422


def test_old_minimal_payload_still_works(client):
    r = client.post("/projects", json={"name": "Alt", "number": "X-1"})
    assert r.status_code == 201 and r.json()["contractors"] == [] and r.json()["budget_eur"] is None


def test_workforce_check_uses_firms_from_project_form(client, engine):
    pid = client.post("/projects", json=JUE_PAYLOAD).json()["id"]
    with Session(engine) as s:
        seed_reports.seed_all(s, s.get(Project, pid))  # Berichte mit Erdbau Krause 1 Person am 17.11.
        s.commit()
        gaps = workforce_check(s, s.get(Project, pid), dt.date(2026, 11, 17))
    assert any(g.company == "Erdbau Krause GmbH" and g.planned == 3 and g.actual == 1 for g in gaps)

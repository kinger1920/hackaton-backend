"""Tests für POST /api/contracts/{id}/parse – Beispielvertrag, ohne Netz (KI gemockt bzw. aus)."""

import pytest
from sqlmodel import Session

from src.models import Contract, Project
from src.services import llm
from src.services.contract_parse import MAX_CHARS, excerpt

CONTRACT_TEXT = """Nachunternehmervertrag Erdarbeiten
zwischen Baupartner AG & Co. KG (Auftraggeber) und Erdbau Krause GmbH (Auftragnehmer)
§ 3 Ausführungsfristen
Ausführungsbeginn: 16.11.2026
Fertigstellung: 18.12.2026
§ 5 Personal
Der Auftragnehmer stellt eine Sollstärke von 6 gewerblichen Arbeitnehmern ständig auf der Baustelle.
§ 7 Besondere Vertragsbedingungen
Behinderungen sind binnen 2 Arbeitstagen schriftlich anzuzeigen.
"""


@pytest.fixture
def contract_id(engine) -> int:
    with Session(engine) as s:
        p = Project(name="Schulzentrum")
        s.add(p)
        s.commit()
        c = Contract(project_id=p.id, title="NU Erdbau", extracted_text=CONTRACT_TEXT)
        empty = Contract(project_id=p.id, title="Scan ohne Text", extracted_text="")
        s.add(c)
        s.add(empty)
        s.commit()
        return c.id


def test_offline_reads_workforce_and_dates(client, contract_id):
    data = client.post(f"/api/contracts/{contract_id}/parse").json()
    assert data["mode"] == "offline"
    f = data["fields"]
    assert f["planned_workforce"]["value"] == 6 and "Sollstärke von 6" in f["planned_workforce"]["src"]
    assert f["execution_start"]["value"] == "16.11.2026" and f["execution_end"]["value"] == "18.12.2026"
    assert data["suggested_patch"] == {"planned_workforce": 6}
    assert data["current_planned_workforce"] is None


def test_parse_saves_nothing(client, engine, contract_id):
    client.post(f"/api/contracts/{contract_id}/parse")
    with Session(engine) as s:
        assert s.get(Contract, contract_id).planned_workforce is None  # nur Vorschlag


def test_ai_values_need_verbatim_quote(client, contract_id, monkeypatch):
    async def fake(system, user, schema, max_tokens=2048):
        assert "Sollstärke von 6" in user
        return schema(
            planned_workforce="6", planned_workforce_quote="Sollstärke von 6 gewerblichen Arbeitnehmern",
            contractor_name="Erdbau Krause GmbH", contractor_name_quote="Erdbau Krause GmbH (Auftragnehmer)",
            trade="Erdbau", trade_quote="Gewerk Erdbau laut Anlage 3",  # steht so nicht im Vertrag → verworfen
            execution_start="16.11.2026", execution_start_quote="Ausführungsbeginn: 16.11.2026",
            execution_end="", execution_end_quote="",
            vob_special="Behinderungen binnen 2 Arbeitstagen schriftlich anzeigen.",
            vob_special_quote="Behinderungen sind binnen 2 Arbeitstagen schriftlich anzuzeigen.",
        )

    monkeypatch.setattr(llm, "complete_json", fake)
    data = client.post(f"/api/contracts/{contract_id}/parse").json()
    assert data["mode"] == "ai"
    assert set(data["fields"]) == {"planned_workforce", "contractor_name", "execution_start", "vob_special"}
    assert data["suggested_patch"] == {"planned_workforce": 6, "contractor_name": "Erdbau Krause GmbH",
                                       "vob_notes": "Behinderungen binnen 2 Arbeitstagen schriftlich anzeigen."}


def test_ai_number_must_appear_in_quote_else_rules_fill_in(client, contract_id, monkeypatch):
    async def fake(system, user, schema, max_tokens=2048):
        empty = {k: "" for k in schema.model_fields}
        return schema(**{**empty, "planned_workforce": "8",  # erfunden: Zitat enthält 6
                         "planned_workforce_quote": "Sollstärke von 6 gewerblichen Arbeitnehmern"})

    monkeypatch.setattr(llm, "complete_json", fake)
    data = client.post(f"/api/contracts/{contract_id}/parse").json()
    assert data["fields"]["planned_workforce"]["value"] == 6  # Regel-Fallback statt KI-Erfindung


def test_errors(client, contract_id):
    assert client.post("/api/contracts/999/parse").status_code == 404
    assert client.post(f"/api/contracts/{contract_id + 1}/parse").status_code == 422


def test_long_contract_keeps_keyword_passages():
    text = "Allgemeines. " * 2000 + "\n§ 12 Personal: Mindestbesetzung 5 Arbeitskräfte.\n" + "Rest. " * 500
    part = excerpt(text)
    assert len(part) <= MAX_CHARS + 50 and "Mindestbesetzung 5" in part

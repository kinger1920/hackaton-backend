"""Tests für Projekt-Assistent (POST /api/assistant/ask, /history), Wetter (GET /api/weather)
und Vertrags-PDF nachträglich anhängen (PUT /contracts/{id}/file).

Alles offline: LLM ist in conftest abgeschaltet, der Wetterdienst wird gemockt (kein Netz).
"""

import datetime as dt
import json

from sqlmodel import Session

from src.models import Contract, DailyReport, FormalNotice, Project
from src.services import assistant, llm, weather

REF = dt.date(2026, 11, 20)


def _seed(engine) -> int:
    with Session(engine) as s:
        p = Project(name="Wohnpark Nord", location="Berliner Str. 42, 10115 Berlin")
        s.add(p)
        s.commit()
        s.refresh(p)
        s.add(Contract(project_id=p.id, title="NU-Vertrag Erdbau", contractor_name="Erdbau Krause",
                       trade="Erdbau", planned_workforce=6))
        s.add(DailyReport(project_id=p.id, report_date=dt.date(2026, 11, 17),
                          weather=json.dumps({"condition": "Regen", "temp_c": 6, "rain_mm": 4}),
                          deviations_incidents="Bagger steht, Leitungspläne fehlen."))
        s.add(FormalNotice(project_id=p.id, type="delay", body="...", subject="Behinderung Achse B",
                           status="Entwurf"))
        s.add(FormalNotice(project_id=p.id, type="cost", body="...", subject="Mehrkosten Wasserhaltung",
                           status="Freigegeben"))
        s.commit()
        return p.id


# ---------------------------------------------------------------- Assistent

def test_ask_offline_open_notices(client, engine):
    pid = _seed(engine)
    res = client.post("/api/assistant/ask", json={"question": "Welche Briefe sind noch nicht freigegeben?",
                                                  "project_id": pid, "ref_date": REF.isoformat()})
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "offline"
    assert "Behinderung Achse B" in body["answer"]
    assert "Mehrkosten" not in body["answer"]
    assert body["sources"] and all(s.startswith("Schreiben #") for s in body["sources"])


def test_ask_offline_contract_workforce(client, engine):
    pid = _seed(engine)
    body = client.post("/api/assistant/ask", json={
        "question": "Wie viele Leute hatte Erdbau Krause laut Vertrag zu stellen?", "project_id": pid,
    }).json()
    assert "6" in body["answer"] and "Erdbau Krause" in body["answer"]
    assert body["sources"][0].startswith("Vertrag #")


def test_ask_offline_incidents_last_week(client, engine):
    pid = _seed(engine)
    body = client.post("/api/assistant/ask", json={
        "question": "Welche Behinderungen gab es letzte Woche?", "project_id": pid, "ref_date": REF.isoformat(),
    }).json()
    assert "Leitungspläne" in body["answer"]
    assert body["sources"] == ["Tagesbericht 17.11.2026"]


def test_ask_llm_drops_unknown_sources(client, engine, monkeypatch):
    pid = _seed(engine)

    async def fake(system, user, schema, max_tokens=0):
        assert "[Tagesbericht 17.11.2026]" in user
        return schema(answer="Wegen fehlender Leitungspläne.",
                      sources=["Tagesbericht 17.11.2026", "Erfundene Quelle"])

    monkeypatch.setattr(llm, "complete_json", fake)
    body = client.post("/api/assistant/ask", json={"question": "Warum Verzug?", "project_id": pid}).json()
    assert body["mode"] == "ai"
    assert body["sources"] == ["Tagesbericht 17.11.2026"]


def test_history_roundtrip_and_clear(client, engine):
    pid = _seed(engine)
    client.post("/api/assistant/ask", json={"question": "Welche Briefe sind offen?", "project_id": pid})
    hist = client.get(f"/api/assistant/history?project_id={pid}").json()
    assert [m["role"] for m in hist] == ["user", "assistant"]
    assert hist[1]["mode"] == "offline"
    assert client.delete(f"/api/assistant/history?project_id={pid}").status_code == 204
    assert client.get(f"/api/assistant/history?project_id={pid}").json() == []


def test_ask_unknown_project_404(client):
    assert client.post("/api/assistant/ask", json={"question": "Hallo?", "project_id": 999}).status_code == 404


def test_select_blocks_keeps_budget_and_fixed():
    blocks = [("Projektstammdaten", "x"), ("A", "beton " * 50), ("B", "kran " * 50), ("C", "beton kran")]
    chosen = assistant.select_blocks(blocks, "Beton", limit=400)
    labels = [b[0] for b in chosen]
    assert labels[0] == "Projektstammdaten"
    assert "A" in labels and "B" not in labels


# ---------------------------------------------------------------- Wetter

def test_location_candidates():
    assert weather.location_candidates("Berliner Str. 42, 10115 Berlin")[:2] == ["Berlin", "10115"]
    assert weather.location_candidates("Hamburg")[0] == "Hamburg"


def test_weather_from_service(client, engine, monkeypatch):
    pid = _seed(engine)
    monkeypatch.setattr(weather, "_geocode_sync", lambda loc: (52.52, 13.41, "Berlin"))
    monkeypatch.setattr(weather, "_daily_sync", lambda lat, lon, day: {
        "code": 61, "t_max": 9.6, "t_min": 4.2, "precipitation_mm": 2.34, "wind_kmh": 18.4, "url": weather.FORECAST_URL})
    body = client.get(f"/api/weather?date=2026-11-17&project_id={pid}").json()
    assert body["temperature_c"] == 7
    assert body["condition"].startswith("Leichter Regen")
    assert body["precipitation_mm"] == 2.3 and body["wind_kmh"] == 18
    assert "Open-Meteo" in body["source"] and "Berlin" in body["source"]


def test_weather_falls_back_to_report(client, engine, monkeypatch):
    pid = _seed(engine)

    def offline(loc):
        raise OSError("kein Netz")

    monkeypatch.setattr(weather, "_geocode_sync", offline)
    res = client.get(f"/api/weather?date=2026-11-17&project_id={pid}")
    assert res.status_code == 200
    assert res.json()["condition"] == "Regen" and res.json()["temperature_c"] == 6
    # ohne Bericht an dem Tag → 503 mit Hinweis
    assert client.get(f"/api/weather?date=2026-11-18&project_id={pid}").status_code == 503


def test_weather_project_without_location(client, engine):
    with Session(engine) as s:
        p = Project(name="Ohne Ort")
        s.add(p)
        s.commit()
        pid = p.id
    assert client.get(f"/api/weather?date=2026-11-17&project_id={pid}").status_code == 422


# ---------------------------------------------------------------- Vertrags-PDF nachträglich

def test_attach_contract_file(client, engine, monkeypatch, tmp_path):
    pid = _seed(engine)
    from src.routers import contracts as contracts_router

    monkeypatch.setattr(contracts_router, "save_contract_pdf",
                        lambda data, name: ("vertrag.pdf", tmp_path / "vertrag.pdf"))
    monkeypatch.setattr(contracts_router, "extract_pdf_text", lambda data: "Sollstärke 6 Arbeitskräfte")
    res = client.put("/contracts/1/file", files={"file": ("vertrag.pdf", b"%PDF-1.4 test", "application/pdf")})
    assert res.status_code == 200
    assert res.json()["file_name"] == "vertrag.pdf"
    assert client.put("/contracts/1/file", files={"file": ("x.txt", b"abc", "text/plain")}).status_code == 400
    assert pid

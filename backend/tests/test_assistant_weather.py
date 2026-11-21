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


# ---------------------------------------------------------------- Wetter: Kachel-Felder (Live-Wetter)

def _fake_api(monkeypatch, daily: dict, current: dict | None = None):
    """Open-Meteo auf HTTP-Ebene mocken; merkt sich die Anfragen."""
    calls = []

    def fake(url, params):
        calls.append((url, params))
        if "geocoding" in url:
            return {"results": [{"latitude": 48.14, "longitude": 11.58, "name": "München"}]}
        return {"daily": {k: [v] for k, v in daily.items()}, **({"current": current} if current else {})}

    weather._geo_cache.clear()
    weather._weather_cache.clear()
    monkeypatch.setattr(weather, "_get_json", fake)
    return calls


DAILY = {"weather_code": 3, "temperature_2m_max": 9.4, "temperature_2m_min": 3.1, "precipitation_sum": 0.4,
         "wind_speed_10m_max": 24.2, "wind_gusts_10m_max": 38.6, "precipitation_probability_max": 58}


def test_weather_today_has_tile_fields_and_current_temp(client, engine, monkeypatch):
    pid = _seed(engine)
    calls = _fake_api(monkeypatch, DAILY, current={"temperature_2m": 5.6, "weather_code": 61})
    today = dt.date.today().isoformat()
    body = client.get(f"/api/weather?date={today}&project_id={pid}").json()
    assert body["temperature_c"] == 6 and body["condition"].startswith("Leichter Regen")  # aktuelle Messung
    assert (body["wind_kmh"], body["wind_gusts_kmh"], body["precipitation_probability"]) == (24, 39, 58)
    assert (body["t_min"], body["t_max"], body["place"]) == (3.1, 9.4, "München")
    assert body["is_wind_warning"] is False and body["crane_status"].startswith("Kran freigegeben")
    assert body["concrete_status"].startswith("Achtung: Winterbaumaßnahmen")  # Tiefstwert 3,1 °C
    forecast = calls[-1][1]
    assert "current" in forecast and "precipitation_probability_max" in forecast["daily"]


def test_weather_gust_warning_and_warm_day(monkeypatch):
    assert weather.site_hints(12.0, 45)["is_wind_warning"] is True
    assert weather.site_hints(12.0, 44.9)["is_wind_warning"] is False
    assert weather.site_hints(5.1, None) == {"crane_status": None, "is_wind_warning": None,
                                            "concrete_status": "Betonage zulässig (> +5 °C)"}


def test_weather_archive_without_probability(client, engine, monkeypatch):
    pid = _seed(engine)
    calls = _fake_api(monkeypatch, {k: v for k, v in DAILY.items() if k != "precipitation_probability_max"})
    old = (dt.date.today() - dt.timedelta(days=200)).isoformat()
    body = client.get(f"/api/weather?date={old}&project_id={pid}").json()
    assert calls[-1][0] == weather.ARCHIVE_URL and "precipitation_probability_max" not in calls[-1][1]["daily"]
    assert "current" not in calls[-1][1]
    assert body["precipitation_probability"] is None and body["temperature_c"] == 6  # Tagesmittel


def test_weather_report_fallback_has_concrete_hint(client, engine, monkeypatch):
    pid = _seed(engine)
    monkeypatch.setattr(weather, "_geocode_sync", lambda loc: (_ for _ in ()).throw(OSError("offline")))
    body = client.get(f"/api/weather?date=2026-11-17&project_id={pid}").json()
    assert body["concrete_status"].startswith("Betonage zulässig") and body["crane_status"] is None

"""Tests für die Wetter-Ausfallsicherheit (GET /api/weather): Bright Sky als Ersatz für Open-Meteo,
Tagesbericht als letzter Fallback, Cache und Fehlertyp in der 503-Meldung.

Alles offline: `_get_json` wird gemockt und zählt die Anfragen je Dienst.
"""

import asyncio
import datetime as dt
import json
import logging
import socket
import ssl
import urllib.error

import pytest
from sqlmodel import Session

from src.models import DailyReport, Project
from src.services import weather

DAY = dt.date(2026, 11, 17)  # an diesem Tag hat der Seed einen Tagesbericht mit Wetter
NO_REPORT_DAY = dt.date(2026, 11, 18)


def _seed(engine, location: str = "Berliner Str. 42, 10115 Berlin") -> int:
    with Session(engine) as s:
        p = Project(name="Wohnpark Nord", location=location)
        s.add(p)
        s.commit()
        s.refresh(p)
        s.add(DailyReport(project_id=p.id, report_date=DAY,
                          weather=json.dumps({"condition": "Regen", "temp_c": 6, "rain_mm": 4})))
        s.commit()
        return p.id


def _brightsky_hours(day: dt.date) -> list[dict]:
    """24 Stundenwerte + 00:00 des Folgetags (wie die echte API), mittags Regen."""
    hours = []
    for h in range(24):
        hours.append({"timestamp": f"{day.isoformat()}T{h:02d}:00:00+01:00", "temperature": 2.0 + h / 4,
                      "precipitation": 0.6 if 11 <= h <= 13 else 0.0, "wind_speed": 10.0 + h,
                      "wind_gust_speed": 20.0 + h, "condition": "rain" if 11 <= h <= 13 else "dry",
                      "icon": "cloudy", "precipitation_probability": 40})
    nxt = day + dt.timedelta(days=1)
    hours.append({"timestamp": f"{nxt.isoformat()}T00:00:00+01:00", "temperature": 99.0, "icon": "clear-night"})
    return hours


def _mock(monkeypatch, *, open_meteo_error: Exception | None = None, brightsky_error: Exception | None = None):
    """Mockt alle Wetter-Hosts. Fehler je Dienst einstellbar; Rückgabe = Liste der Aufrufe (URL)."""
    calls: list[str] = []

    def fake(url: str, params: dict) -> dict:
        calls.append(url)
        if "open-meteo" in url:
            if open_meteo_error:
                raise open_meteo_error
            if "geocoding" in url:
                return {"results": [{"latitude": 52.52, "longitude": 13.41, "name": "Berlin"}]}
            return {"daily": {"weather_code": [3], "temperature_2m_max": [7.0], "temperature_2m_min": [3.0],
                              "precipitation_sum": [0.0], "wind_speed_10m_max": [12.0],
                              "wind_gusts_10m_max": [25.0]}}
        if "brightsky" in url:
            if brightsky_error:
                raise brightsky_error
            if "current_weather" in url:
                return {"weather": {"temperature": 4.4, "condition": "dry", "icon": "partly-cloudy-day"}}
            return {"weather": _brightsky_hours(dt.date.fromisoformat(params["date"]))}
        raise AssertionError(f"unerwartete URL {url}")

    monkeypatch.setattr(weather, "_get_json", fake)
    return calls


HTTP_429 = urllib.error.HTTPError("https://api.open-meteo.com", 429, "Too Many Requests", {}, None)


def test_open_meteo_429_falls_back_to_brightsky(client, engine, monkeypatch):
    pid = _seed(engine)
    _mock(monkeypatch, open_meteo_error=HTTP_429)
    res = client.get(f"/api/weather?date={DAY}&project_id={pid}")
    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "Bright Sky (DWD) (Messung/Modell), Berlin"  # Koordinaten aus der Städtetabelle
    assert body["condition"].startswith("Regen")  # Niederschlag vor Bewölkung
    assert (body["t_min"], body["t_max"]) == (2.0, 7.8)  # Folgetag-00:00 (99 °C) nicht mitgezählt
    assert body["precipitation_mm"] == 1.8 and body["wind_gusts_kmh"] == 43
    assert body["precipitation_probability"] == 40
    assert body["concrete_status"].startswith("Achtung: Winterbaumaßnahmen")


def test_brightsky_today_uses_current_measurement(client, engine, monkeypatch):
    pid = _seed(engine)
    calls = _mock(monkeypatch, open_meteo_error=HTTP_429)
    today = dt.date.today()
    body = client.get(f"/api/weather?date={today}&project_id={pid}").json()
    assert body["temperature_c"] == 4 and body["condition"].startswith("Teilweise bewölkt")
    assert any("current_weather" in u for u in calls)


def test_open_meteo_ok_does_not_ask_brightsky(client, engine, monkeypatch):
    pid = _seed(engine)
    calls = _mock(monkeypatch)
    body = client.get(f"/api/weather?date={DAY}&project_id={pid}").json()
    assert body["source"].startswith("Open-Meteo")
    assert not any("brightsky" in u for u in calls)


def test_both_down_uses_report_or_503_with_error_kinds(client, engine, monkeypatch):
    pid = _seed(engine)
    _mock(monkeypatch, open_meteo_error=HTTP_429,
          brightsky_error=urllib.error.URLError(TimeoutError("timed out")))
    # Tag mit Bericht → gespeichertes Wetter
    res = client.get(f"/api/weather?date={DAY}&project_id={pid}")
    assert res.status_code == 200 and res.json()["source"].startswith("Tagesbericht")
    # Tag ohne Bericht → 503 mit Fehlertyp je Dienst (für das Render-Log und die Fehlersuche)
    res = client.get(f"/api/weather?date={NO_REPORT_DAY}&project_id={pid}")
    assert res.status_code == 503
    assert res.json()["detail"] == "Wetterdienst nicht erreichbar (Open-Meteo: HTTP 429; Bright Sky: Timeout)."


def test_unknown_place_without_geocoding_is_503(client, engine, monkeypatch):
    pid = _seed(engine, location="Musterweg 1, 99999 Kleinkleckersdorf")
    _mock(monkeypatch, open_meteo_error=HTTP_429)
    res = client.get(f"/api/weather?date={NO_REPORT_DAY}&project_id={pid}")
    assert res.status_code == 503 and res.json()["detail"] == "Wetterdienst nicht erreichbar (Geocoding: HTTP 429)."


def test_cache_answers_repeated_calls(client, engine, monkeypatch):
    pid = _seed(engine)
    calls = _mock(monkeypatch)
    today = dt.date.today()
    for _ in range(3):
        assert client.get(f"/api/weather?date={today}&project_id={pid}").status_code == 200
    assert len(calls) == 2  # 1× Geocoding + 1× Forecast, Aufruf 2 und 3 aus dem Cache


def test_cache_expires_after_ttl(engine, monkeypatch):
    calls = _mock(monkeypatch)
    clock = [1000.0]
    monkeypatch.setattr(weather.time, "monotonic", lambda: clock[0])
    loc = "Berliner Str. 42, 10115 Berlin"
    today = dt.date.today()
    asyncio.run(weather.fetch_weather(loc, today))
    clock[0] += weather.CACHE_TTL_TODAY_S - 1
    asyncio.run(weather.fetch_weather(loc, today))
    assert sum("forecast" in u for u in calls) == 1  # noch im Cache
    clock[0] += 2
    asyncio.run(weather.fetch_weather(loc, today))
    assert sum("forecast" in u for u in calls) == 2  # abgelaufen → neu geholt


def test_parallel_calls_are_bundled(monkeypatch):
    calls = _mock(monkeypatch)

    async def three():
        loc = "Berliner Str. 42, 10115 Berlin"
        return await asyncio.gather(*[weather.fetch_weather(loc, dt.date.today()) for _ in range(3)])

    results = asyncio.run(three())
    assert len({r["source"] for r in results}) == 1
    assert sum("forecast" in u for u in calls) == 1


def test_failures_are_cached_briefly(client, engine, monkeypatch):
    pid = _seed(engine)
    calls = _mock(monkeypatch, open_meteo_error=HTTP_429, brightsky_error=HTTP_429)
    for _ in range(2):
        assert client.get(f"/api/weather?date={NO_REPORT_DAY}&project_id={pid}").status_code == 503
    assert sum("brightsky" in u for u in calls) == 1  # zweiter Aufruf fragt nicht erneut extern an


def test_warning_is_logged(engine, monkeypatch, caplog):
    _mock(monkeypatch, open_meteo_error=HTTP_429)
    with caplog.at_level(logging.WARNING, logger="src.services.weather"):
        asyncio.run(weather.fetch_weather("Berliner Str. 42, 10115 Berlin", DAY))
    assert "Open-Meteo nicht erreichbar: HTTP 429" in caplog.text


@pytest.mark.parametrize("exc, kind", [
    (HTTP_429, "HTTP 429"),
    (urllib.error.URLError(ssl.SSLError("bad cert")), "SSL"),
    (urllib.error.URLError(TimeoutError("timed out")), "Timeout"),
    (TimeoutError("timed out"), "Timeout"),
    (urllib.error.URLError(socket.gaierror("no host")), "DNS"),
    (json.JSONDecodeError("x", "doc", 0), "ungültige Antwort"),
    (ConnectionResetError("reset"), "Netzwerk"),
])
def test_error_kind(exc, kind):
    assert weather.error_kind(exc) == kind

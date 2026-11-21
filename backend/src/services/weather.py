"""Wetter für Baustelle + Datum (Kern von GET /api/weather).

Quelle: Open-Meteo (kostenlos, kein API-Key). Ablauf:
1. Standort des Projekts (`Project.location`, z. B. "Berliner Str. 42, 10115 Berlin") → Koordinaten
   über die Open-Meteo-Geocoding-API (sucht nach Ortsnamen, deshalb werden Straße/PLZ abgeschnitten).
2. Tageswerte (Wettercode, Temperatur min/max, Niederschlag, Wind) für das Datum:
   bis ~3 Monate zurück und 16 Tage voraus über die Forecast-API, ältere Tage über die Archiv-API.
Fällt das Netz aus, nutzt der Router das im Tagesbericht gespeicherte Wetter (Offline-Fallback).

Bewusst nur Standardbibliothek (urllib) – keine neue Abhängigkeit. Ergebnisse werden im Speicher
gecacht, damit wiederholtes Klicken auf „Automatisch“ keine weiteren Anfragen auslöst.
"""

import asyncio
import datetime as dt
import json
import logging
import re
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
TIMEOUT_SECONDS = 6.0
# Forecast-API liefert past_days bis 92 Tage zurück; davor nur das Archiv.
FORECAST_PAST_LIMIT_DAYS = 90
FORECAST_FUTURE_LIMIT_DAYS = 15

# WMO-Wettercodes → deutsche Kurzbeschreibung (https://open-meteo.com/en/docs, "WMO Weather interpretation codes")
WMO_DE: dict[int, str] = {
    0: "Sonnig", 1: "Überwiegend sonnig", 2: "Teilweise bewölkt", 3: "Bewölkt",
    45: "Nebel", 48: "Nebel mit Reif",
    51: "Leichter Nieselregen", 53: "Nieselregen", 55: "Starker Nieselregen",
    56: "Gefrierender Nieselregen", 57: "Starker gefrierender Nieselregen",
    61: "Leichter Regen", 63: "Regen", 65: "Starker Regen",
    66: "Gefrierender Regen", 67: "Starker gefrierender Regen",
    71: "Leichter Schneefall", 73: "Schneefall", 75: "Starker Schneefall", 77: "Schneegriesel",
    80: "Leichte Regenschauer", 81: "Regenschauer", 82: "Heftige Regenschauer",
    85: "Leichte Schneeschauer", 86: "Starke Schneeschauer",
    95: "Gewitter", 96: "Gewitter mit Hagel", 99: "Schweres Gewitter mit Hagel",
}

_geo_cache: dict[str, tuple[float, float, str] | None] = {}
_weather_cache: dict[tuple[float, float, dt.date], dict] = {}


class WeatherUnavailable(Exception):
    """Wetterdienst nicht erreichbar oder keine Daten für Ort/Datum."""


def _get_json(url: str, params: dict) -> dict:
    full = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(full, headers={"User-Agent": "site-assistant-backend"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:  # noqa: S310 (feste https-URLs)
        return json.loads(resp.read().decode("utf-8"))


def location_candidates(location: str) -> list[str]:
    """Suchbegriffe für die Geocoding-API, vom genauesten zum gröbsten.

    "Berliner Str. 42, 10115 Berlin" → ["Berlin", "10115", "Berliner Str. 42, 10115 Berlin"]
    (die API sucht Ortsnamen; Straßen findet sie nicht).
    """
    parts = [p.strip() for p in location.split(",") if p.strip()]
    candidates: list[str] = []
    for part in reversed(parts):
        m = re.match(r"^(?:D-)?(\d{5})\s+(.+)$", part)
        if m:
            candidates += [m.group(2).strip(), m.group(1)]
        elif not re.search(r"\d", part):
            candidates.append(part)
    candidates.append(location.strip())
    seen: set[str] = set()
    return [c for c in candidates if c and not (c.lower() in seen or seen.add(c.lower()))]


def _geocode_sync(location: str) -> tuple[float, float, str] | None:
    key = location.strip().lower()
    if key in _geo_cache:
        return _geo_cache[key]
    result = None
    for name in location_candidates(location):
        data = _get_json(GEOCODING_URL, {"name": name, "count": 1, "language": "de", "format": "json"})
        hits = data.get("results") or []
        if hits:
            hit = hits[0]
            result = (float(hit["latitude"]), float(hit["longitude"]), str(hit.get("name") or name))
            break
    _geo_cache[key] = result
    return result


def _daily_sync(lat: float, lon: float, day: dt.date) -> dict:
    cache_key = (round(lat, 3), round(lon, 3), day)
    if cache_key in _weather_cache:
        return _weather_cache[cache_key]
    today = dt.date.today()
    if day < today - dt.timedelta(days=FORECAST_PAST_LIMIT_DAYS):
        url = ARCHIVE_URL
    elif day > today + dt.timedelta(days=FORECAST_FUTURE_LIMIT_DAYS):
        raise WeatherUnavailable("Für Tage mehr als 15 Tage in der Zukunft gibt es noch keine Vorhersage.")
    else:
        url = FORECAST_URL
    data = _get_json(url, {
        "latitude": lat, "longitude": lon,
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max",
        "timezone": "Europe/Berlin",
        "start_date": day.isoformat(), "end_date": day.isoformat(),
    })
    daily = data.get("daily") or {}

    def first(name: str):
        values = daily.get(name) or []
        return values[0] if values else None

    t_max, t_min = first("temperature_2m_max"), first("temperature_2m_min")
    if t_max is None and t_min is None:
        raise WeatherUnavailable("Wetterdienst liefert für dieses Datum keine Werte.")
    result = {
        "code": first("weather_code"),
        "t_max": t_max,
        "t_min": t_min,
        "precipitation_mm": first("precipitation_sum"),
        "wind_kmh": first("wind_speed_10m_max"),
        "url": url,
    }
    # Vergangene Tage ändern sich nicht mehr → cachen; heutige/künftige nicht (Vorhersage wird genauer).
    if day < today:
        _weather_cache[cache_key] = result
    return result


def describe(code) -> str:
    try:
        return WMO_DE.get(int(code), "Wetterlage unbekannt")
    except (TypeError, ValueError):
        return "Wetterlage unbekannt"


async def fetch_weather(location: str, day: dt.date) -> dict:
    """Wetter am Standort für einen Tag im Format von `WeatherResponse`.

    Raises WeatherUnavailable, wenn Ort nicht gefunden oder Dienst nicht erreichbar.
    """
    try:
        geo = await asyncio.to_thread(_geocode_sync, location)
        if geo is None:
            raise WeatherUnavailable(f"Standort „{location}“ wurde nicht gefunden.")
        lat, lon, place = geo
        daily = await asyncio.to_thread(_daily_sync, lat, lon, day)
    except WeatherUnavailable:
        raise
    except Exception as exc:  # Netzwerk, Timeout, kaputtes JSON – Demo darf nie abstürzen
        logger.warning("Wetterdienst nicht erreichbar: %s", exc)
        raise WeatherUnavailable("Wetterdienst nicht erreichbar.") from exc

    t_max, t_min = daily["t_max"], daily["t_min"]
    temps = [t for t in (t_max, t_min) if t is not None]
    temperature = round(sum(temps) / len(temps)) if temps else None
    condition = describe(daily["code"])
    if t_min is not None and t_max is not None:
        condition += f" ({round(t_min)} bis {round(t_max)} °C)"
    kind = "Archiv" if daily["url"] == ARCHIVE_URL else ("Vorhersage" if day > dt.date.today() else "Messung/Modell")
    return {
        "date": day.isoformat(),
        "temperature_c": temperature,
        "condition": condition,
        "wind_kmh": round(daily["wind_kmh"]) if daily["wind_kmh"] is not None else None,
        "precipitation_mm": round(daily["precipitation_mm"], 1) if daily["precipitation_mm"] is not None else None,
        "source": f"Open-Meteo ({kind}), {place}",
    }

"""Wetter für Baustelle + Datum (Kern von GET /api/weather).

Quellen (beide kostenlos, ohne API-Key), in dieser Reihenfolge:
1. Open-Meteo: Standort (`Project.location`, z. B. "Berliner Str. 42, 10115 Berlin") → Koordinaten
   über die Geocoding-API (sucht Ortsnamen, deshalb werden Straße/PLZ abgeschnitten). Fällt die
   aus, helfen fest hinterlegte Koordinaten großer deutscher Städte. Dann Tageswerte: bis ~3 Monate
   zurück und 15 Tage voraus über die Forecast-API, ältere Tage über die Archiv-API.
2. Bright Sky (DWD-Daten, api.brightsky.dev), wenn Open-Meteo scheitert – z. B. wenn ein Server
   mit geteilter IP (Render) dort gesperrt ist (HTTP 429).
Scheitern beide, nutzt der Router das im Tagesbericht gespeicherte Wetter (Offline-Fallback).

Bewusst nur Standardbibliothek (urllib) – keine neue Abhängigkeit. Ergebnisse werden im Speicher
gecacht (heute 30 Min, Fehler 2 Min) und gleichzeitige Anfragen gebündelt: Das Frontend ruft
/api/weather oft mehrfach parallel auf, rausgehen soll trotzdem nur EINE Anfrage.
"""

import asyncio
import datetime as dt
import json
import logging
import re
import socket
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter

logger = logging.getLogger(__name__)

GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
BRIGHTSKY_URL = "https://api.brightsky.dev/weather"
BRIGHTSKY_CURRENT_URL = "https://api.brightsky.dev/current_weather"
TIMEOUT_SECONDS = 6.0
# Forecast-API liefert past_days bis 92 Tage zurück; davor nur das Archiv.
FORECAST_PAST_LIMIT_DAYS = 90
FORECAST_FUTURE_LIMIT_DAYS = 15

# Cache-Dauer: heute/Zukunft ändert sich (Vorhersage, aktuelle Messung) → 30 Min;
# vergangene Tage sind fest → 6 h; Fehler nur kurz merken, damit ein gesperrter Dienst
# nicht bei jedem Klick erneut 2× angefragt wird, er aber bald wieder probiert wird.
CACHE_TTL_TODAY_S = 30 * 60
CACHE_TTL_PAST_S = 6 * 60 * 60
CACHE_TTL_ERROR_S = 2 * 60

# Baustellen-Schwellen (fester Code, keine KI – testbar):
# Turmdrehkrane werden üblicherweise ab Böen um 45 km/h (≈ 12,5 m/s) außer Betrieb genommen.
CRANE_GUST_LIMIT_KMH = 45
# Bis +5 °C sind beim Betonieren Winterbaumaßnahmen nötig (Frischbeton-Schutz).
CONCRETE_MIN_TEMP_C = 5

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

# Bright Sky: Niederschlagsart ("condition") hat Vorrang vor dem Bewölkungs-Icon.
BRIGHTSKY_CONDITION_DE = [  # Reihenfolge = Wichtigkeit für die Tagesbeschreibung
    ("thunderstorm", "Gewitter"), ("hail", "Hagel"), ("snow", "Schneefall"),
    ("sleet", "Schneeregen"), ("rain", "Regen"), ("fog", "Nebel"),
]
BRIGHTSKY_ICON_DE = {
    "clear-day": "Sonnig", "clear-night": "Klar", "partly-cloudy-day": "Teilweise bewölkt",
    "partly-cloudy-night": "Teilweise bewölkt", "cloudy": "Bewölkt", "fog": "Nebel", "wind": "Windig",
    "rain": "Regen", "sleet": "Schneeregen", "snow": "Schneefall", "hail": "Hagel", "thunderstorm": "Gewitter",
}

# Ersatz-Koordinaten, falls die Geocoding-API nicht erreichbar ist (Demo-Projekt: Berlin).
CITY_COORDS: dict[str, tuple[float, float]] = {
    "berlin": (52.52, 13.41), "hamburg": (53.55, 9.99), "münchen": (48.14, 11.58),
    "köln": (50.94, 6.96), "frankfurt am main": (50.11, 8.68), "frankfurt": (50.11, 8.68),
    "stuttgart": (48.78, 9.18), "düsseldorf": (51.23, 6.78), "leipzig": (51.34, 12.37),
    "dortmund": (51.51, 7.47), "essen": (51.46, 7.01), "bremen": (53.08, 8.80),
    "dresden": (51.05, 13.74), "hannover": (52.37, 9.73), "nürnberg": (49.45, 11.08),
    "potsdam": (52.40, 13.07),
}

_geo_cache: dict[str, tuple[float, float, str] | None] = {}
# (Standort, Tag) → (gültig bis [time.monotonic], Ergebnis-Dict ODER WeatherUnavailable)
_weather_cache: dict[tuple[str, dt.date], tuple[float, object]] = {}
_key_locks: dict[tuple[str, dt.date], threading.Lock] = {}
_key_locks_guard = threading.Lock()


class WeatherUnavailable(Exception):
    """Wetterdienst nicht erreichbar oder keine Daten für Ort/Datum."""


def clear_caches() -> None:
    """Alle Wetter-Caches leeren (für Tests und nach Standortänderungen)."""
    _geo_cache.clear()
    _weather_cache.clear()


def error_kind(exc: BaseException) -> str:
    """Kurzer, geheimnisfreier Fehlertyp für Log und 503-Meldung, z. B. "HTTP 429", "SSL", "Timeout"."""
    if isinstance(exc, urllib.error.HTTPError):  # vor URLError prüfen (ist eine Unterklasse)
        return f"HTTP {exc.code}"
    reason = exc.reason if isinstance(exc, urllib.error.URLError) else exc
    if isinstance(reason, ssl.SSLError):
        return "SSL"
    if isinstance(reason, TimeoutError):
        return "Timeout"
    if isinstance(reason, socket.gaierror):
        return "DNS"
    if isinstance(reason, (ValueError, KeyError, TypeError)):  # inkl. kaputtes JSON
        return "ungültige Antwort"
    if isinstance(reason, OSError):
        return "Netzwerk"
    return type(exc).__name__


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


def _known_city(location: str) -> tuple[float, float, str] | None:
    """Fest hinterlegte Koordinaten für den Ort, falls er eine bekannte Großstadt ist."""
    for name in location_candidates(location):
        coords = CITY_COORDS.get(name.lower())
        if coords:
            return coords[0], coords[1], name
    return None


def _geocode_sync(location: str) -> tuple[float, float, str] | None:
    """Standort → (lat, lon, Ortsname); None = Ort unbekannt.

    Ist die Geocoding-API nicht erreichbar, helfen die hinterlegten Großstädte; sonst wird der
    Netzwerkfehler weitergereicht (→ Fehlertyp in der 503-Meldung).
    """
    key = location.strip().lower()
    if key in _geo_cache:
        return _geo_cache[key]
    result = None
    try:
        for name in location_candidates(location):
            data = _get_json(GEOCODING_URL, {"name": name, "count": 1, "language": "de", "format": "json"})
            hits = data.get("results") or []
            if hits:
                hit = hits[0]
                result = (float(hit["latitude"]), float(hit["longitude"]), str(hit.get("name") or name))
                break
    except Exception as exc:
        known = _known_city(location)
        if known is None:
            raise
        logger.warning("Geocoding nicht erreichbar (%s) – nutze hinterlegte Koordinaten für %s",
                       error_kind(exc), known[2])
        return known  # nicht cachen: beim nächsten Mal die genauere API erneut probieren
    _geo_cache[key] = result
    return result


def _daily_sync(lat: float, lon: float, day: dt.date) -> dict:
    """Tageswerte von Open-Meteo (Forecast- bzw. Archiv-API)."""
    today = dt.date.today()
    url = ARCHIVE_URL if day < today - dt.timedelta(days=FORECAST_PAST_LIMIT_DAYS) else FORECAST_URL
    data = _get_json(url, {
        "latitude": lat, "longitude": lon,
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,"
                 "wind_gusts_10m_max" + (",precipitation_probability_max" if url == FORECAST_URL else ""),
        "timezone": "Europe/Berlin",
        "start_date": day.isoformat(), "end_date": day.isoformat(),
        # Heute: zusätzlich die aktuelle Messung, damit die Kachel "jetzt" zeigt statt Tagesmittel.
        **({"current": "temperature_2m,weather_code"} if day == today else {}),
    })
    daily = data.get("daily") or {}
    current = data.get("current") or {}

    def first(name: str):
        values = daily.get(name) or []
        return values[0] if values else None

    t_max, t_min = first("temperature_2m_max"), first("temperature_2m_min")
    if t_max is None and t_min is None:
        raise WeatherUnavailable("Wetterdienst liefert für dieses Datum keine Werte.")
    return {
        "code": first("weather_code"),
        "t_max": t_max,
        "t_min": t_min,
        "precipitation_mm": first("precipitation_sum"),
        "wind_kmh": first("wind_speed_10m_max"),
        "gusts_kmh": first("wind_gusts_10m_max"),
        "precip_probability": first("precipitation_probability_max"),  # Archiv: keine Wahrscheinlichkeit
        "current_temp": current.get("temperature_2m"),
        "current_code": current.get("weather_code"),
        "url": url,
    }


def _brightsky_text(records: list[dict]) -> str:
    """Tagesbeschreibung aus Bright-Sky-Stundenwerten: Niederschlagsart vor Bewölkung."""
    conditions = {r.get("condition") for r in records}
    for key, text in BRIGHTSKY_CONDITION_DE:
        if key in conditions:
            if key == "rain" and sum(r.get("precipitation") or 0 for r in records) < 1:
                return "Leichter Regen"
            return text
    # Trocken: häufigstes Icon tagsüber (8–17 Uhr), sonst über den ganzen Tag.
    daytime = [r for r in records if 8 <= int(str(r.get("timestamp", "T00"))[11:13] or 0) <= 17] or records
    icons = Counter(r.get("icon") for r in daytime if r.get("icon"))
    return BRIGHTSKY_ICON_DE.get(icons.most_common(1)[0][0], "Wetterlage unbekannt") if icons else "Wetterlage unbekannt"


def _brightsky_daily(lat: float, lon: float, day: dt.date) -> dict:
    """Tageswerte von Bright Sky (DWD) im gleichen Format wie `_daily_sync`."""
    data = _get_json(BRIGHTSKY_URL, {
        "lat": lat, "lon": lon, "date": day.isoformat(),
        "last_date": (day + dt.timedelta(days=1)).isoformat(), "tz": "Europe/Berlin",
    })
    # Antwort enthält auch 00:00 des Folgetags → nur Stunden des gewünschten Tages.
    records = [r for r in data.get("weather") or [] if str(r.get("timestamp", "")).startswith(day.isoformat())]
    temps = [r["temperature"] for r in records if r.get("temperature") is not None]
    if not temps:
        raise WeatherUnavailable("Bright Sky liefert für dieses Datum keine Werte.")

    def maximum(name: str):
        values = [r[name] for r in records if r.get(name) is not None]
        return max(values) if values else None

    rain = [r["precipitation"] for r in records if r.get("precipitation") is not None]
    result = {
        "condition_text": _brightsky_text(records),
        "t_max": max(temps),
        "t_min": min(temps),
        "precipitation_mm": sum(rain) if rain else None,
        "wind_kmh": maximum("wind_speed"),
        "gusts_kmh": maximum("wind_gust_speed"),
        "precip_probability": maximum("precipitation_probability"),
        "current_temp": None,
        "current_text": None,
        "provider": "Bright Sky (DWD)",
    }
    if day == dt.date.today():
        # Aktuelle Messung für die Kachel; scheitert sie, bleibt das Tagesmittel.
        try:
            now = (_get_json(BRIGHTSKY_CURRENT_URL, {"lat": lat, "lon": lon, "tz": "Europe/Berlin"})
                   .get("weather") or {})
            result["current_temp"] = now.get("temperature")
            if now:
                result["current_text"] = _brightsky_text([now])
        except Exception as exc:
            logger.warning("Bright Sky current_weather nicht erreichbar: %s", error_kind(exc))
    return result


# Reihenfolge der Wetterdienste: erster Erfolg gewinnt.
PROVIDERS = (("Open-Meteo", "_daily_sync"), ("Bright Sky", "_brightsky_daily"))


def describe(code) -> str:
    try:
        return WMO_DE.get(int(code), "Wetterlage unbekannt")
    except (TypeError, ValueError):
        return "Wetterlage unbekannt"


def site_hints(t_min: float | None, gusts_kmh: float | None) -> dict:
    """Baustellen-Hinweise aus Tiefsttemperatur und Böen (None = unbekannt → kein Hinweis).

    → {crane_status, is_wind_warning, concrete_status}
    """
    hints: dict = {"crane_status": None, "is_wind_warning": None, "concrete_status": None}
    if gusts_kmh is not None:
        warn = gusts_kmh >= CRANE_GUST_LIMIT_KMH
        hints["is_wind_warning"] = warn
        hints["crane_status"] = (f"Böenwarnung: Kranbetrieb prüfen (≥ {CRANE_GUST_LIMIT_KMH} km/h)" if warn
                                 else f"Kran freigegeben (< {CRANE_GUST_LIMIT_KMH} km/h)")
    if t_min is not None:
        hints["concrete_status"] = (f"Betonage zulässig (> +{CONCRETE_MIN_TEMP_C} °C)" if t_min > CONCRETE_MIN_TEMP_C
                                    else f"Achtung: Winterbaumaßnahmen prüfen (≤ +{CONCRETE_MIN_TEMP_C} °C)")
    return hints


def _format(daily: dict, day: dt.date, place: str) -> dict:
    """Rohwerte eines Wetterdienstes → Format von `WeatherResponse`."""
    t_max, t_min = daily["t_max"], daily["t_min"]
    temps = [t for t in (t_max, t_min) if t is not None]
    temperature = round(sum(temps) / len(temps)) if temps else None
    condition = daily.get("condition_text") or describe(daily.get("code"))
    if daily.get("current_temp") is not None:  # heute: aktuelle Messung statt Tagesmittel
        temperature = round(daily["current_temp"])
        if daily.get("current_text"):
            condition = daily["current_text"]
        elif daily.get("current_code") is not None:
            condition = describe(daily["current_code"])
    if t_min is not None and t_max is not None:
        condition += f" ({round(t_min)} bis {round(t_max)} °C)"
    if daily.get("url") == ARCHIVE_URL:
        kind = "Archiv"
    else:
        kind = "Vorhersage" if day > dt.date.today() else "Messung/Modell"
    provider = daily.get("provider") or "Open-Meteo"
    return {
        "date": day.isoformat(),
        "temperature_c": temperature,
        "condition": condition,
        "wind_kmh": round(daily["wind_kmh"]) if daily.get("wind_kmh") is not None else None,
        "precipitation_mm": round(daily["precipitation_mm"], 1) if daily.get("precipitation_mm") is not None else None,
        "source": f"{provider} ({kind}), {place}",
        "wind_gusts_kmh": round(daily["gusts_kmh"]) if daily.get("gusts_kmh") is not None else None,
        "precipitation_probability": daily.get("precip_probability"),
        "t_min": round(t_min, 1) if t_min is not None else None,
        "t_max": round(t_max, 1) if t_max is not None else None,
        "place": place,
        **site_hints(t_min, daily.get("gusts_kmh")),
    }


def _fetch_uncached(location: str, day: dt.date) -> dict:
    """Ein Abruf ohne Cache: Geocoding, dann Open-Meteo, bei Fehler Bright Sky.

    Raises WeatherUnavailable mit Fehlertyp je Dienst, z. B.
    "Wetterdienst nicht erreichbar (Open-Meteo: HTTP 429; Bright Sky: Timeout)."
    """
    if day > dt.date.today() + dt.timedelta(days=FORECAST_FUTURE_LIMIT_DAYS):
        raise WeatherUnavailable("Für Tage mehr als 15 Tage in der Zukunft gibt es noch keine Vorhersage.")
    try:
        geo = _geocode_sync(location)
    except Exception as exc:  # Netzwerk, Timeout, kaputtes JSON – Demo darf nie abstürzen
        kind = error_kind(exc)
        logger.warning("Geocoding nicht erreichbar: %s (%s)", kind, exc)
        raise WeatherUnavailable(f"Wetterdienst nicht erreichbar (Geocoding: {kind}).") from exc
    if geo is None:
        raise WeatherUnavailable(f"Standort „{location}“ wurde nicht gefunden.")
    lat, lon, place = geo

    errors: list[str] = []
    for name, func_name in PROVIDERS:
        try:
            # Über globals() nachschlagen, damit Tests einzelne Dienste per monkeypatch ersetzen können.
            return _format(globals()[func_name](lat, lon, day), day, place)
        except WeatherUnavailable as exc:
            errors.append(f"{name}: keine Daten")
            logger.warning("%s: %s", name, exc)
        except Exception as exc:
            kind = error_kind(exc)
            errors.append(f"{name}: {kind}")
            logger.warning("%s nicht erreichbar: %s (%s)", name, kind, exc)
    raise WeatherUnavailable(f"Wetterdienst nicht erreichbar ({'; '.join(errors)}).")


def _lock_for(key: tuple[str, dt.date]) -> threading.Lock:
    with _key_locks_guard:
        return _key_locks.setdefault(key, threading.Lock())


def _fetch_cached(location: str, day: dt.date) -> dict:
    """Wie `_fetch_uncached`, aber mit Cache und gebündelten parallelen Aufrufen.

    Warum Lock je (Ort, Tag): Kommen 3 Anfragen gleichzeitig, wartet die 2. und 3. auf die
    erste und nimmt dann deren Ergebnis aus dem Cache – statt 3× extern anzufragen.
    """
    key = (location.strip().lower(), day)
    with _lock_for(key):
        hit = _weather_cache.get(key)
        if hit and hit[0] > time.monotonic():
            value = hit[1]
            if isinstance(value, WeatherUnavailable):
                raise value
            return dict(value)
        try:
            result = _fetch_uncached(location, day)
        except WeatherUnavailable as exc:
            _weather_cache[key] = (time.monotonic() + CACHE_TTL_ERROR_S, exc)
            raise
        ttl = CACHE_TTL_PAST_S if day < dt.date.today() else CACHE_TTL_TODAY_S
        _weather_cache[key] = (time.monotonic() + ttl, result)
        return dict(result)


async def fetch_weather(location: str, day: dt.date) -> dict:
    """Wetter am Standort für einen Tag im Format von `WeatherResponse`.

    Läuft im Thread (urllib blockiert). Raises WeatherUnavailable, wenn der Ort nicht gefunden
    wird oder kein Wetterdienst erreichbar ist (Meldung enthält den Fehlertyp je Dienst).
    """
    return await asyncio.to_thread(_fetch_cached, location, day)

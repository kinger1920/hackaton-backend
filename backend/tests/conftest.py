"""Gemeinsame Test-Helfer: `src` importierbar machen + In-Memory-DB und API-Client.

Die Fixtures nutzen eine eigene SQLite-Datenbank im Arbeitsspeicher (nie `site_assistant.db`)
und schalten den Groq-Client ab → kein Netz, kein Tokenverbrauch, KI-Pfade laufen offline.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import Session, SQLModel, create_engine  # noqa: E402

import src.models  # noqa: E402,F401  – registriert alle Tabellen
from src.database import get_session  # noqa: E402
from src.main import app  # noqa: E402
from src.services import llm  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_weather_cache():
    # Der Wetter-Cache lebt im Modul; ohne Leeren sähe ein Test die Antwort des vorigen.
    from src.services import weather

    weather.clear_caches()
    yield


@pytest.fixture
def engine(monkeypatch):
    # StaticPool: alle Verbindungen teilen dieselbe In-Memory-DB.
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng)
    monkeypatch.setattr(llm, "get_client", lambda: None)
    return eng


@pytest.fixture
def client(engine):
    def _session():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_session] = _session
    # Ohne `with`: Der Startup-Hook (init_db auf der echten DB) läuft so nicht.
    yield TestClient(app)
    app.dependency_overrides.clear()

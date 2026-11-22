"""Tests für den Deploy-Modus: Frontend über das Backend, CORS aus .env, Demo-Seed beim Start."""

import datetime as dt

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from src.config import Settings
from src.frontend_static import mount_frontend
from src.models import Project
from src.services.demo import seed_if_empty

HTML = {"accept": "text/html,application/xhtml+xml"}


@pytest.fixture
def dist(tmp_path):
    """Nachgebautes `frontend/dist` mit index.html, Bundle und einer public-Datei."""
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html>APP</html>")
    (tmp_path / "assets" / "index-abc.js").write_text("console.log(1)")
    (tmp_path / "logo.svg").write_text("<svg/>")
    (tmp_path.parent / "secret.txt").write_text("geheim")
    return tmp_path


@pytest.fixture
def site(dist):
    """Mini-App mit denselben Routen-Arten wie main.py (+ eingebundenem Frontend)."""
    app = FastAPI()

    @app.get("/projects")
    def projects():
        return [{"id": 1}]

    @app.get("/api/notices")
    def notices():
        return []

    @app.post("/api/capture")
    def capture():
        return {"ok": True}

    assert mount_frontend(app, dist)
    return TestClient(app)


def test_page_load_gets_app_but_fetch_gets_json(site):
    # Gleicher Pfad: Reload im Browser → App, fetch() aus der App → JSON des Backends.
    assert site.get("/projects", headers=HTML).text == "<html>APP</html>"
    assert site.get("/projects").json() == [{"id": 1}]


def test_root_and_frontend_routes_serve_app(site):
    for path in ("/", "/login", "/capture/voice", "/drafts"):
        assert site.get(path, headers=HTML).text == "<html>APP</html>", path


def test_api_and_docs_never_hijacked(site):
    assert site.get("/api/notices", headers=HTML).json() == []
    assert site.post("/api/capture", headers=HTML).json() == {"ok": True}
    docs = site.get("/docs", headers=HTML)
    assert docs.status_code == 200 and "swagger" in docs.text.lower()


def test_static_files_served(site):
    assert site.get("/assets/index-abc.js").text == "console.log(1)"
    assert site.get("/logo.svg", headers={"accept": "image/*"}).text == "<svg/>"


def test_no_access_outside_dist(site):
    r = site.get("/..%2Fsecret.txt")
    assert "geheim" not in r.text


def test_missing_dist_is_no_crash(tmp_path):
    assert mount_frontend(FastAPI(), tmp_path / "gibtsnicht") is False


def test_cors_origin_list_from_env():
    s = Settings(cors_origins=" https://a.example.com/ ,https://b.example.com,, ")
    assert s.cors_origin_list == ["https://a.example.com", "https://b.example.com"]
    assert Settings(cors_origins="").cors_origin_list == []


def test_seed_if_empty_only_once(engine):
    with Session(engine) as s:
        first = seed_if_empty(s, dt.date(2026, 11, 22))
        assert first and first["ok"]
        assert seed_if_empty(s, dt.date(2026, 11, 22)) is None  # Daten da → nichts anfassen
        assert len(s.exec(select(Project)).all()) == 1

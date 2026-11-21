"""Tests für POST /api/demo/reset – leert die DB, lädt die Demo, verschiebt sie auf den Stichtag."""

import datetime as dt

from sqlmodel import Session, select

from src.config import settings
from src.models import Company, DailyReport, Project
from src.services.demo import add_workdays, last_workday_before, workday_offset


def _reset(client, ref):
    r = client.post(f"/api/demo/reset?ref_date={ref}")
    assert r.status_code == 200, r.text
    return r.json()


def test_reset_wipes_everything_and_loads_demo(client, engine):
    client.post("/projects", json={"name": "Testmüll"})
    data = _reset(client, "2026-11-22")  # Demo-Sonntag
    assert data["ok"] and data["project_id"] == 1  # Frontend-Default-Projekt
    assert (data["reports"], data["contracts"], data["tasks"], data["notes"]) == (15, 2, 23, 2)  # 6 Seed + 17 Folgevorgänge
    assert data["last_report_date"] == "2026-11-20" and data["shifted_workdays"] == 0
    with Session(engine) as s:
        assert [p.name for p in s.exec(select(Project)).all()] == ["Neubau Schulzentrum Nord (Haus B & C)"]
        assert len(s.exec(select(Company)).all()) == 2


def test_reset_is_repeatable(client):
    first = _reset(client, "2026-11-22")
    client.post("/api/reports/2026-11-23/fill", json={"text": "Fa. Krause nur 2 Mann.", "project_id": 1})
    assert _reset(client, "2026-11-22") == first


def test_demo_story_is_ready_for_jury(client):
    _reset(client, "2026-11-22")
    p = client.get("/projects/1").json()
    assert p["construction_volume_eur"] == 18_500_000 and len(p["contractors"]) == 2
    assert client.get("/api/analysis?project_id=1&period=all&ref_date=2026-11-20").json()["overallDelta"] == -1.8
    alerts = client.get("/api/dashboard?project_id=1&ref_date=2026-11-18").json()["alerts"]
    assert alerts[0]["prefillText"]  # Sollstärke-Vorschlag
    timeline = client.get("/api/timeline?project_id=1&from=2026-11-17&to=2026-11-18&types=note").json()["items"]
    assert any("tylko" in i["summary"] for i in timeline)  # polnisches Diktat


def test_dates_shift_by_workdays_to_ref(client, engine):
    data = _reset(client, "2026-12-02")  # Mittwoch → letzter Bericht Dienstag 01.12.
    assert data["last_report_date"] == "2026-12-01" and data["shifted_workdays"] == 7
    with Session(engine) as s:
        days = [r.report_date for r in s.exec(select(DailyReport).order_by(DailyReport.report_date)).all()]
        assert all(d.weekday() < 5 for d in days) and days[-1] == dt.date(2026, 12, 1)
        stillstand = s.exec(select(DailyReport).where(DailyReport.report_number == 132)).first()
    # Text-Datum wandert mit: Seed "Pläne bis 19.11. zu" → 7 Werktage später = 30.11.
    assert "bis 30.11. zu" in stillstand.deviations_incidents
    # Soll/Ist-Story bleibt gleich: 1,8 AT Verzug am letzten Berichtstag.
    assert client.get("/api/analysis?project_id=1&period=all&ref_date=2026-12-01").json()["overallDelta"] == -1.8


def test_disabled_returns_403(client, monkeypatch):
    monkeypatch.setattr(settings, "demo_reset_enabled", False)
    assert client.post("/api/demo/reset").status_code == 403


def test_workday_helpers():
    assert last_workday_before(dt.date(2026, 11, 23)) == dt.date(2026, 11, 20)  # Montag → Freitag
    assert add_workdays(dt.date(2026, 11, 20), 1) == dt.date(2026, 11, 23)
    assert add_workdays(dt.date(2026, 11, 23), -1) == dt.date(2026, 11, 20)
    assert workday_offset(dt.date(2026, 11, 13)) == -5


def test_demo_photos_are_valid_svg(client):
    """Regression: Texte mit "&" machten die Demo-SVGs ungültig (Bild lädt im Browser nicht)."""
    import xml.etree.ElementTree as ET

    _reset(client, "2026-11-22")
    photos = client.get("/api/photos?project_id=1").json()
    assert photos
    for p in photos:
        ET.fromstring(client.get(p["url"]).content)  # wirft bei ungültigem XML

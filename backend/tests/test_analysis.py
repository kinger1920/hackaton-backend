"""Tests für Soll/Ist-Analyse, Tagesanalyse und Dashboard – auf den Demo-Seed-Daten, ohne Netz."""

import datetime as dt
import importlib.util
from pathlib import Path

import pytest
from sqlmodel import Session

from src.models import PlanTask, Project
from src.services import analysis, llm

_SEED = Path(__file__).resolve().parent.parent / "scripts" / "seed_reports.py"
_spec = importlib.util.spec_from_file_location("seed_reports", _SEED)
seed_reports = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seed_reports)


@pytest.fixture
def seeded(engine) -> int:
    with Session(engine) as s:
        p = Project(name="Schulzentrum")
        s.add(p)
        s.commit()
        seed_reports.seed_all(s, p)
        s.commit()
        return p.id


# ---------------------------------------------------------------- Rechenregeln

def _task(start: str, end: str) -> PlanTask:
    return PlanTask(plan_id=1, title="T", planned_start=dt.date.fromisoformat(start),
                    planned_end=dt.date.fromisoformat(end))


@pytest.mark.parametrize("ref,expected", [
    ("2026-11-13", 0),     # vor Start
    ("2026-11-16", 25),    # 1 von 4 Werktagen
    ("2026-11-18", 75),
    ("2026-11-19", 100),   # letzter Plantag
    ("2026-11-25", 100),   # nach Ende
])
def test_plan_percent(ref, expected):
    assert analysis.plan_percent(_task("2026-11-16", "2026-11-19"), dt.date.fromisoformat(ref)) == expected


def test_weekend_is_not_a_workday():
    task = _task("2026-11-13", "2026-11-16")  # Fr + Mo = 2 Werktage
    assert analysis.duration(task) == 2
    assert analysis.plan_percent(task, dt.date(2026, 11, 14)) == 50  # Samstag zählt nicht


def test_delay_days():
    task = _task("2026-11-16", "2026-11-19")
    assert analysis.delay_days(task, 100, 55) == 1.8
    assert analysis.delay_days(task, 50, 80) == 0.0  # Vorsprung = kein negativer Verzug


# ---------------------------------------------------------------- Plan-Analyse auf Seed-Daten

def test_plan_analysis_week_shows_aushub_delay(client, seeded):
    r = client.get(f"/api/analysis?project_id={seeded}&period=week&ref_date=2026-11-20")
    assert r.status_code == 200
    d = r.json()
    aushub = next(w for w in d["workPackages"] if w["id"] == "B-200")
    assert (aushub["planPercent"], aushub["actualPercent"], aushub["delayDays"]) == (100, 55, 1.8)
    assert aushub["status"] == "delayed"
    assert aushub["actualDate"].startswith("Prognose")
    assert d["overallDelta"] == -1.8
    assert d["spi"] < 1
    assert d["evaluatedReports"] == 5

    first = d["deviations"][0]
    assert first["severity"] == "critical"
    assert first["sourceReport"] == "Tagesbericht 17.11.2026"
    assert first["draftType"] == "delay"
    assert "Leitungspläne" in first["cause"]
    assert "§ 6" in first["vobReference"]
    assert "Aushub Achse B" in first["impact"]


def test_plan_analysis_all_counts_every_report(client, seeded):
    d = client.get(f"/api/analysis?project_id={seeded}&period=all&ref_date=2026-11-20").json()
    assert d["evaluatedReports"] == 15
    assert d["periodFrom"] is None
    titles = " ".join(x["cause"] for x in d["deviations"])
    assert "Starkregen" in titles and "Betonlieferung" in titles


def test_project_without_plan(client, engine):
    with Session(engine) as s:
        p = Project(name="Leer")
        s.add(p)
        s.commit()
        pid = p.id
    d = client.get(f"/api/analysis?project_id={pid}&ref_date=2026-11-20").json()
    assert d["workPackages"] == [] and d["deviations"] == [] and d["spi"] == 1.0


def test_unknown_project_404(client):
    assert client.get("/api/analysis?project_id=999").status_code == 404
    assert client.get("/api/dashboard?project_id=999").status_code == 404


# ---------------------------------------------------------------- Tagesanalyse

def test_day_analysis_bad_day_offline(client, seeded):
    d = client.get(f"/api/reports/2026-11-17/analysis?project_id={seeded}").json()
    assert d["mode"] == "offline"
    bad = " | ".join(x["text"] for x in d["wentBadly"])
    assert "Aushub Achse B: Ist 30 % statt Soll 50 %" in bad
    assert "Personal unter Soll" in bad
    assert "Bagger steht" in bad
    assert all(x["source"] == "Tagesbericht 17.11.2026" for x in d["wentBadly"])
    assert d["deviations"][0]["severity"] == "critical"


def test_day_analysis_good_day_offline(client, seeded):
    d = client.get(f"/api/reports/2026-11-13/analysis?project_id={seeded}").json()
    good = " | ".join(x["text"] for x in d["wentWell"])
    assert "Fundamente Achse A abgeschlossen" in good
    assert d["wentBadly"] == []


def test_day_analysis_merges_ai_items(client, seeded, monkeypatch):
    async def fake(system, user, schema, max_tokens=2048):
        assert "Bewehrungsabnahme" in user
        return schema(wentWell=["Bewehrungsabnahme ohne Beanstandung."], wentBadly=["Beton 3 h verspätet."])

    monkeypatch.setattr(llm, "complete_json", fake)
    d = client.get(f"/api/reports/2026-11-12/analysis?project_id={seeded}").json()
    assert d["mode"] == "ai"
    assert "Bewehrungsabnahme ohne Beanstandung." in [x["text"] for x in d["wentWell"]]
    assert "Beton 3 h verspätet." in [x["text"] for x in d["wentBadly"]]


def test_day_without_report(client, seeded):
    d = client.get(f"/api/reports/2026-11-21/analysis?project_id={seeded}").json()
    assert d["wentWell"] == [] and "Kein Tagesbericht" in d["wentBadly"][0]["text"]


# ---------------------------------------------------------------- Dashboard

def test_dashboard(client, seeded):
    d = client.get(f"/api/dashboard?project_id={seeded}&ref_date=2026-11-20").json()
    assert d["kpis"]["delayDays"] == 1.8
    assert d["kpis"]["workersToday"] == 11
    assert d["kpis"]["openDrafts"] == 0
    assert d["alerts"] and d["alerts"][0]["source"] == "Tagesbericht 17.11.2026"
    assert len(d["progress"]) == 6

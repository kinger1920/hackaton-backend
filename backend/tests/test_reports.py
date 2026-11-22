"""Tests für /api/reports (GET/PUT/fill) und die Spalten-Ergänzung – offline, LLM gemockt."""

import datetime as dt

from sqlalchemy import inspect, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, create_engine

from src.database import add_missing_columns
from src.models import ConstructionPlan, PlanTask, Project, SiteNote
from src.services import llm


def _setup(engine) -> dict:
    """Projekt mit Plan (2 Vorgänge) + zweites Projekt mit eigenem Vorgang."""
    with Session(engine) as s:
        p, other = Project(name="Schulzentrum"), Project(name="Anderes Projekt")
        s.add_all([p, other])
        s.commit()
        plan, plan2 = ConstructionPlan(project_id=p.id, title="Plan"), ConstructionPlan(project_id=other.id, title="P2")
        s.add_all([plan, plan2])
        s.commit()
        aushub = PlanTask(plan_id=plan.id, task_code="B-200", title="Aushub Achse B",
                          planned_start=dt.date(2026, 11, 16), planned_end=dt.date(2026, 11, 19))
        wand = PlanTask(plan_id=plan.id, task_code="A-130", title="Wände Achse A")
        foreign = PlanTask(plan_id=plan2.id, task_code="X-1", title="Fremd")
        s.add_all([aushub, wand, foreign])
        s.commit()
        return {"project": p.id, "other": other.id, "aushub": aushub.id, "wand": wand.id, "foreign": foreign.id}


def test_get_unknown_day_returns_empty_draft(client, engine):
    ids = _setup(engine)
    r = client.get(f"/api/reports/2026-11-21?project_id={ids['project']}")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] is None and data["status"] == "draft" and data["progress"] == []


def test_put_then_get_maps_fields(client, engine):
    ids = _setup(engine)
    body = {"report_number": 143, "weather": "9°C, bedeckt", "workforce_count": 34,
            "trades": ["Rohbau (Fa. BetonTech)", "Tiefbau"], "work_completed": "Bewehrung fertig.",
            "deviations_incidents": "Schacht 3 blockiert.", "deliveries": "2x Betonstahl.",
            "progress": [{"task_id": ids["aushub"], "percent": 60}]}
    r = client.put(f"/api/reports/2026-11-21?project_id={ids['project']}", json=body)
    assert r.status_code == 200
    data = client.get(f"/api/reports/2026-11-21?project_id={ids['project']}").json()
    assert data["id"] is not None
    assert data["weather"] == "9°C, bedeckt"
    assert data["trades"] == ["Rohbau (Fa. BetonTech)", "Tiefbau"]
    assert data["deliveries"] == "2x Betonstahl."
    assert data["progress"] == [{"task_id": ids["aushub"], "task_code": "B-200", "title": "Aushub Achse B",
                                 "percent": 60, "source": "nutzer", "note": None}]

    # Zweites PUT ersetzt den Fortschritt komplett.
    body["progress"] = [{"task_id": ids["wand"], "percent": 10}]
    data = client.put(f"/api/reports/2026-11-21?project_id={ids['project']}", json=body).json()
    assert [p["task_code"] for p in data["progress"]] == ["A-130"]


def test_put_rejects_foreign_task_and_bad_percent(client, engine):
    ids = _setup(engine)
    url = f"/api/reports/2026-11-21?project_id={ids['project']}"
    r = client.put(url, json={"progress": [{"task_id": ids["foreign"], "percent": 50}]})
    assert r.status_code == 422
    assert r.json()["detail"] == {"unknown_task_ids": [ids["foreign"]]}
    assert client.put(url, json={"progress": [{"task_id": ids["aushub"], "percent": 140}]}).status_code == 422


def test_unknown_project_and_bad_date(client, engine):
    _setup(engine)
    assert client.get("/api/reports/2026-11-21?project_id=999").status_code == 404
    assert client.get("/api/reports/21.11.2026").status_code == 422


def test_fill_offline(client, engine):
    ids = _setup(engine)
    text = "Bewehrung Decke fertig. Aushub Achse B zu 60 % fertig. Bagger steht wegen fehlender Pläne."
    r = client.post("/api/reports/2026-11-21/fill", json={"text": text, "project_id": ids["project"]})
    assert r.status_code == 200
    data = r.json()
    assert data["mode"] == "offline"
    assert "Bewehrung Decke fertig." in data["work_completed"]
    assert "Bagger steht" in data["deviations_incidents"]
    assert data["progress"][0]["task_code"] == "B-200"
    assert data["progress"][0]["percent"] == 60 and data["progress"][0]["source"] == "regel"
    with Session(engine) as s:
        note = s.get(SiteNote, data["site_note_id"])
        assert note.content == text and note.category == "delay"


def test_fill_with_categorized_bullets(client, engine):
    ids = _setup(engine)
    payload = {
        "text": "",
        "project_id": ids["project"],
        "categories": {
            "progress": ["Aushub Achse B zu 75 % fertig", "Decke 1. OG geschalt"],
            "trades": ["Rohbau (Fa. BetonTech)", "Elektro"],
            "hindrance": ["Kran steht wegen Sturm"],
            "cost": ["Zusätzliche Wasserhaltung"],
            "defect": ["Riss im Treppenhaus"],
            "delivery": ["2x LKW Betonstahl B500B angeliefert"],
        },
    }
    r = client.post("/api/reports/2026-11-22/fill", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert "Aushub Achse B zu 75 % fertig" in data["work_completed"]
    assert "Decke 1. OG geschalt" in data["work_completed"]
    assert "Rohbau (Fa. BetonTech)" not in data["work_completed"]
    assert data["trades"] == ["Rohbau (Fa. BetonTech)", "Elektro"]
    assert "Behinderung: Kran steht wegen Sturm" in data["deviations_incidents"]
    assert "Mehrkosten: Zusätzliche Wasserhaltung" in data["deviations_incidents"]
    assert "Mangel: Riss im Treppenhaus" in data["deviations_incidents"]
    assert "2x LKW Betonstahl B500B angeliefert" in data["deliveries"]
    assert data["progress"][0]["task_code"] == "B-200"
    assert data["progress"][0]["percent"] == 75
    assert data["categories"] == payload["categories"]

    # GET liefert die übernommenen Stichpunkte weiterhin zurück
    loaded = client.get(f"/api/reports/2026-11-22?project_id={ids['project']}").json()
    assert loaded["categories"] == payload["categories"]

    # Entfernen eines Stichpunkts löscht ihn aus categories UND aus dem Tagesbericht (andere bleiben erhalten)
    after_rm_progress = client.post(
        "/api/reports/2026-11-22/bullets/remove",
        json={"category": "progress", "text": "Decke 1. OG geschalt", "project_id": ids["project"]},
    ).json()
    assert after_rm_progress["categories"]["progress"] == ["Aushub Achse B zu 75 % fertig"]
    assert "Decke 1. OG geschalt" not in (after_rm_progress["work_completed"] or "")
    assert "Aushub Achse B zu 75 % fertig" in (after_rm_progress["work_completed"] or "")

    after_rm_hindrance = client.post(
        "/api/reports/2026-11-22/bullets/remove",
        json={"category": "hindrance", "text": "Kran steht wegen Sturm", "project_id": ids["project"]},
    ).json()
    assert after_rm_hindrance["categories"]["hindrance"] == []
    assert "Kran steht wegen Sturm" not in (after_rm_hindrance["deviations_incidents"] or "")
    assert "Mehrkosten: Zusätzliche Wasserhaltung" in (after_rm_hindrance["deviations_incidents"] or "")

    after_rm_delivery = client.post(
        "/api/reports/2026-11-22/bullets/remove",
        json={"category": "delivery", "text": "2x LKW Betonstahl B500B angeliefert", "project_id": ids["project"]},
    ).json()
    assert after_rm_delivery["categories"]["delivery"] == []
    assert after_rm_delivery["deliveries"] is None

    after_rm_trade = client.post(
        "/api/reports/2026-11-22/bullets/remove",
        json={"category": "trades", "text": "Elektro", "project_id": ids["project"]},
    ).json()
    assert after_rm_trade["categories"]["trades"] == ["Rohbau (Fa. BetonTech)"]
    assert after_rm_trade["trades"] == ["Rohbau (Fa. BetonTech)"]

    # Manuelles Löschen im Tagesbericht (PUT) bereinigt auch categories
    after_put = client.put(
        f"/api/reports/2026-11-22?project_id={ids['project']}",
        json={"work_completed": "", "deviations_incidents": "Mehrkosten: Zusätzliche Wasserhaltung", "deliveries": ""},
    ).json()
    assert after_put["categories"]["progress"] == []
    assert after_put["categories"]["cost"] == ["Zusätzliche Wasserhaltung"]
    assert after_put["categories"]["defect"] == []

    with Session(engine) as s:
        note = s.get(SiteNote, data["site_note_id"])
        assert note.category == "delay"
        assert "Behinderungen: Kran steht wegen Sturm" in note.content

    # Leerer Text ohne Stichpunkte wird weiterhin abgelehnt (422).
    assert client.post("/api/reports/2026-11-22/fill", json={"text": "   ", "project_id": ids["project"]}).status_code == 422


def test_fill_ai_validates_and_appends(client, engine, monkeypatch):
    ids = _setup(engine)
    url = f"/api/reports/2026-11-21?project_id={ids['project']}"
    client.put(url, json={"work_completed": "Schalung gestellt.", "weather": "sonnig"})

    async def fake(system, user, schema, max_tokens=2048):
        assert "B-200: Aushub Achse B" in user  # Vorgangsliste wird mitgeschickt
        return schema(work_completed="Aushub Achse B fortgesetzt.", deviations_incidents="", temperature_c="", attendance=[],
                      deliveries="", weather="Regen", workforce_count="12 Personen", trades=["Erdbau"],
                      progress=[{"task_code": "B-200", "percent": 80},
                                {"task_code": "Z-999", "percent": 50},   # unbekannt → verworfen
                                {"task_code": "A-130", "percent": 140}])  # > 100 → verworfen

    monkeypatch.setattr(llm, "complete_json", fake)
    data = client.post("/api/reports/2026-11-21/fill",
                       json={"text": "Wykop osi B kontynuowany", "lang": "pl", "project_id": ids["project"]}).json()
    assert data["mode"] == "ai"
    assert data["work_completed"] == "Schalung gestellt.\nAushub Achse B fortgesetzt."  # angehängt
    assert data["deviations_incidents"] is None  # leeres KI-Feld überschreibt nichts
    assert data["weather"] == "sonnig"  # vorhandenes Wetter bleibt
    assert data["workforce_count"] == 12
    assert data["trades"] == ["Erdbau"]
    assert [(p["task_code"], p["percent"], p["source"]) for p in data["progress"]] == [("B-200", 80, "ki")]


def test_add_missing_columns_upgrades_old_table():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with eng.begin() as conn:
        # Altes Schema ohne die neuen Spalten, mit einem Bestandsdatensatz.
        conn.execute(text("CREATE TABLE dailyreport (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, "
                          "report_date DATE NOT NULL, status VARCHAR NOT NULL)"))
        conn.execute(text("INSERT INTO dailyreport VALUES (1, 1, '2026-11-17', 'draft')"))
    added = add_missing_columns(eng)
    assert {"dailyreport.deliveries", "dailyreport.trades", "dailyreport.workforce_count",
            "dailyreport.report_number"} <= set(added)
    cols = {c["name"] for c in inspect(eng).get_columns("dailyreport")}
    assert {"deliveries", "trades", "workforce_count", "report_number"} <= cols
    assert add_missing_columns(eng) == []  # idempotent
    with eng.connect() as conn:
        assert conn.execute(text("SELECT status FROM dailyreport WHERE id = 1")).scalar() == "draft"

"""Tests für GET /api/progress/building (2,5D-Gebäudeansicht im Baufortschritt) – offline."""

import datetime as dt

import pytest
from sqlmodel import Session

from src.models import ConstructionPlan, FormalNotice, PlanTask, Project
from src.services import progress_map


@pytest.mark.parametrize("text,house,level", [
    ("Haus B · UG (Achse A)", "Haus B", "UG"),
    ("Decke über 1.OG Haus C", "Haus C", "1.OG"),
    ("Bauteil 2, 3. Obergeschoss", "Haus 2", "3.OG"),
    ("Dachabdichtung Haus B", "Haus B", "Dach"),
    ("Fundamente Achse A", None, "Gründung"),
    ("Erdgeschoss", None, "EG"),
    ("Baufeld · Baustelleneinrichtung Nord", None, None),
])
def test_parse_location(text, house, level):
    assert progress_map.parse_house(text) == house
    assert progress_map.parse_level(text) == level


def test_axis_maps_to_house():
    assert progress_map.parse_house("Sockel Achse A", {"A": "Haus B"}) == "Haus B"


def test_level_order():
    assert progress_map.level_order({"Dach", "EG", "10.OG", "2.OG", "Gründung"}) == \
        ["Gründung", "EG", "2.OG", "10.OG", "Dach"]


def test_demo_building(client):
    assert client.post("/api/demo/reset?ref_date=2026-11-22").status_code == 200
    data = client.get("/api/progress/building?project_id=1").json()
    assert data["houses"] == ["Haus B", "Haus C"]
    assert data["levels"] == ["Gründung", "UG", "EG", "1.OG", "2.OG", "Dach"]
    assert data["lastReportDate"] == "2026-11-20"
    assert len(data["tasks"]) == 23
    site = next(t for t in data["tasks"] if t["code"] == "A-100")
    assert site["house"] is None  # Baustelleneinrichtung gehört zu keinem Haus
    a120 = next(t for t in data["tasks"] if t["code"] == "A-120")
    assert a120["history"][-1] == {"date": "2026-11-13", "percent": 100}

    defect = next(e for e in data["events"] if e["kind"] == "defect" and e["noticeId"])  # Fugenband + Mängelrüge
    assert (defect["house"], defect["level"]) == ("Haus B", "Gründung")
    assert a120["id"] in defect["taskIds"] and defect["defectId"] and defect["status"] == "in_bearbeitung"
    # verknüpfte Mängelrüge/Foto erscheinen nicht zusätzlich als eigenes Ereignis
    assert not any(e["id"] == f"notice-{defect['noticeId']}" for e in data["events"])
    done = next(e for e in data["events"] if e["kind"] == "defect" and e["status"] == "abgenommen")
    assert done["resolvedDate"] == "2026-11-11"
    stillstand = [e for e in data["events"] if e["kind"] == "incident" and "Achse B" in e["detail"]]
    assert stillstand and all((e["house"], e["level"]) == ("Haus C", "Gründung") for e in stillstand)


def test_soll_ist_story_unchanged_by_extra_tasks(client):
    client.post("/api/demo/reset?ref_date=2026-11-22")
    analysis = client.get("/api/analysis?project_id=1&period=all&ref_date=2026-11-20").json()
    assert analysis["overallDelta"] == -1.8


def test_notice_without_place_is_unassigned(client, engine):
    with Session(engine) as s:
        p = Project(name="Leer")
        s.add(p)
        s.commit()
        s.refresh(p)
        plan = ConstructionPlan(project_id=p.id, title="Plan")
        s.add(plan)
        s.commit()
        s.add(PlanTask(plan_id=plan.id, task_code="1", title="Wände EG Haus A",
                       planned_start=dt.date(2026, 11, 2), planned_end=dt.date(2026, 11, 6)))
        s.add(FormalNotice(project_id=p.id, type="defect", body="Riss irgendwo", subject="Riss"))
        s.commit()
        pid = p.id
    data = client.get(f"/api/progress/building?project_id={pid}").json()
    assert data["houses"] == ["Haus A"] and data["levels"] == ["EG"]
    assert data["events"][0]["house"] is None


def test_unknown_project_404(client):
    assert client.get("/api/progress/building?project_id=999").status_code == 404

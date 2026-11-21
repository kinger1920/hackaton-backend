"""Tests für das Mängelmanagement (/api/defects) – offline, In-Memory-DB."""

import datetime as dt

from sqlmodel import Session, select

from src.models import ConstructionPlan, Defect, PlanTask, Project
from src.services import defects as defect_service
from src.services import documents

TODAY = dt.date.today()


def _project(engine) -> int:
    with Session(engine) as s:
        p = Project(name="Wohnpark Nord")
        s.add(p)
        s.commit()
        s.refresh(p)
        plan = ConstructionPlan(project_id=p.id, title="Plan")
        s.add(plan)
        s.commit()
        s.add(PlanTask(plan_id=plan.id, task_code="1", title="Wände EG", location="Haus B · EG (Achse A)",
                       planned_start=dt.date(2026, 11, 2), planned_end=dt.date(2026, 11, 6)))
        s.commit()
        return p.id


def _create(client, pid, **extra):
    body = {"project_id": pid, "title": "Riss in Wand", **extra}
    res = client.post("/api/defects", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def test_create_detects_place_from_location(client, engine):
    pid = _project(engine)
    d = _create(client, pid, location="Achse A, Erdgeschoss, Raum 0.12", company="BetonTech")
    assert (d["house"], d["level"]) == ("Haus B", "EG")  # Achse A → Haus B aus dem Bauzeitenplan gelernt
    assert d["status"] == "offen" and d["found_date"] == TODAY.isoformat() and not d["is_overdue"]


def test_status_flow_sets_and_clears_dates(client, engine):
    pid = _project(engine)
    d = _create(client, pid)
    d = client.patch(f"/api/defects/{d['id']}", json={"status": "behoben"}).json()
    assert d["resolved_date"] == TODAY.isoformat() and d["accepted_date"] is None
    d = client.patch(f"/api/defects/{d['id']}", json={"status": "abgenommen"}).json()
    assert d["accepted_date"] == TODAY.isoformat() and d["resolved_date"] == TODAY.isoformat()
    d = client.patch(f"/api/defects/{d['id']}", json={"status": "offen"}).json()
    assert d["resolved_date"] is None and d["accepted_date"] is None


def test_overdue_sorting_filter_and_summary(client, engine):
    pid = _project(engine)
    late = _create(client, pid, title="Überfällig", deadline=(TODAY - dt.timedelta(days=3)).isoformat(),
                   company="Erdbau Krause")
    _create(client, pid, title="Später", deadline=(TODAY + dt.timedelta(days=5)).isoformat(), priority="hoch")
    done = _create(client, pid, title="Erledigt", deadline=(TODAY - dt.timedelta(days=9)).isoformat(),
                   status="abgenommen")
    rows = client.get(f"/api/defects?project_id={pid}").json()
    assert rows[0]["id"] == late["id"] and rows[0]["is_overdue"] and rows[0]["days_overdue"] == 3
    assert not next(r for r in rows if r["id"] == done["id"])["is_overdue"]  # abgenommen ist nie überfällig
    open_rows = client.get(f"/api/defects?project_id={pid}&status=open").json()
    assert {r["title"] for r in open_rows} == {"Überfällig", "Später"}
    assert [r["title"] for r in client.get(f"/api/defects?project_id={pid}&overdue=true").json()] == ["Überfällig"]
    summary = client.get(f"/api/defects/summary?project_id={pid}").json()
    assert summary["open"] == 2 and summary["overdue"] == 1 and summary["by_status"]["abgenommen"] == 1
    assert summary["by_company"][0] == {"company": "Erdbau Krause", "open": 1, "overdue": 1}


def test_location_change_reparses_place(client, engine):
    pid = _project(engine)
    d = _create(client, pid, location="Haus B · EG")
    d = client.patch(f"/api/defects/{d['id']}", json={"location": "Haus C, 2. OG Treppenhaus"}).json()
    assert (d["house"], d["level"]) == ("Haus C", "2.OG")


def test_delete_and_project_delete_cascade(client, engine):
    pid = _project(engine)
    d = _create(client, pid)
    _create(client, pid, title="Zweiter")
    assert client.delete(f"/api/defects/{d['id']}").status_code == 204
    assert client.delete(f"/api/defects/{d['id']}").status_code == 404
    assert client.delete(f"/projects/{pid}").status_code == 204  # Mängel blockieren das Projekt-Löschen nicht
    with Session(engine) as s:
        assert s.exec(select(Defect)).all() == []


def test_export_docx_and_pdf(client, engine, monkeypatch):
    pid = _project(engine)
    _create(client, pid, title="Kiesnest Sockel", deadline=(TODAY - dt.timedelta(days=2)).isoformat())
    res = client.get(f"/api/defects/export/docx?project_id={pid}")
    assert res.status_code == 200 and res.content[:2] == b"PK"
    assert "Maengelliste_" in res.headers["content-disposition"]
    monkeypatch.setattr(defect_service, "pdf_available", lambda: False)
    assert client.get(f"/api/defects/export/pdf?project_id={pid}").status_code == 503
    assert client.get(f"/api/defects/export/xls?project_id={pid}").status_code == 404
    assert documents.pdf_available() in (True, False)


def test_validation_and_404(client, engine):
    pid = _project(engine)
    assert client.post("/api/defects", json={"project_id": pid, "title": ""}).status_code == 422
    assert client.post("/api/defects", json={"project_id": pid, "title": "x", "status": "kaputt"}).status_code == 422
    assert client.post("/api/defects", json={"project_id": 999, "title": "x"}).status_code == 404
    assert client.get("/api/defects?project_id=999").status_code == 404
    assert client.patch("/api/defects/999", json={"title": "x"}).status_code == 404


def test_demo_defects_and_dashboard_alert(client):
    client.post("/api/demo/reset?ref_date=2026-11-22")
    rows = client.get("/api/defects?project_id=1&ref_date=2026-11-20").json()
    assert len(rows) == 4 and rows[0]["title"].startswith("Absturzsicherung") and rows[0]["is_overdue"]
    linked = next(r for r in rows if r["notice_id"])
    assert linked["photo_id"] and linked["status"] == "in_bearbeitung"
    alerts = client.get("/api/dashboard?project_id=1&ref_date=2026-11-20").json()["alerts"]
    overdue = [a for a in alerts if a["title"].startswith("Mangel überfällig")]
    assert len(overdue) == 1 and overdue[0]["draftType"] == "defect" and overdue[0]["prefillText"]
    # am 18.11. ist die Frist noch nicht vorbei → Demo-Story (Sollstärke-Alert zuerst) unverändert
    alerts18 = client.get("/api/dashboard?project_id=1&ref_date=2026-11-18").json()["alerts"]
    assert not any(a["title"].startswith("Mangel überfällig") for a in alerts18)


def test_blank_strings_become_null(client, engine):
    pid = _project(engine)
    d = _create(client, pid, deadline="", company="  ", location="")
    assert d["deadline"] is None and d["company"] is None and d["location"] is None

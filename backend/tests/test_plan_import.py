"""Tests: Terminplan-Import (CSV/PDF-Vorschau), Bulk-Übernahme und Vorgangs-CRUD – ohne Netz."""

import datetime as dt

import pytest
from sqlmodel import Session, select

from src.models import ConstructionPlan, DailyReport, PlanTask, Project, ReportProgress
from src.services import llm, plan_import

CSV_DE = """Nr;Vorgangsname;Gewerk;Anfang;Ende
A-130;Wände Achse A;Rohbau;Mo 23.11.26;Mo 30.11.26
B-210;Fundamente Achse B;Rohbau;23.11.2026;27.11.2026
C-300;Decke Achse A;Rohbau;01.12.2026;kaputt
C-310;Treppen;Rohbau;10.12.2026;01.12.2026
""".encode("cp1252")

CSV_EN = b"ID,Task Name,Start,Finish\n1,Baustelleneinrichtung,2026-11-02,2026-11-02\n2,Aushub,2026-11-03,2026-11-06\n"

PDF_TEXT = """Bauzeitenplan Rohbau Haus B
A-130 Wände Achse A 23.11.2026 - 30.11.2026
B-210 Fundamente Achse B 23.11.2026 - 27.11.2026
"""


@pytest.fixture
def plan_id(engine) -> int:
    with Session(engine) as s:
        p = Project(name="Schulzentrum")
        s.add(p)
        s.commit()
        plan = ConstructionPlan(project_id=p.id, title="Bauzeitenplan", version="1.0")
        s.add(plan)
        s.commit()
        return plan.id


def _upload(client, plan_id, data, name, dry_run=False, ctype="text/csv"):
    return client.post(f"/api/plans/{plan_id}/import?dry_run={str(dry_run).lower()}",
                       files={"file": (name, data, ctype)})


def test_csv_german_ms_project_export(client, plan_id):
    r = _upload(client, plan_id, CSV_DE, "plan.csv").json()
    assert (r["mode"], r["created"], r["updated"]) == ("csv", 2, 0)
    assert [(e["row"], "Datum" in e["error"] or "vor Anfang" in e["error"]) for e in r["errors"]] == [(4, True), (5, True)]
    tasks = client.get(f"/api/plans/{plan_id}/tasks").json()
    a130 = next(t for t in tasks if t["task_code"] == "A-130")
    assert (a130["planned_start"], a130["planned_end"], a130["trade"]) == ("2026-11-23", "2026-11-30", "Rohbau")


def test_csv_english_comma_and_dry_run(client, plan_id):
    r = _upload(client, plan_id, CSV_EN, "plan.csv", dry_run=True).json()
    assert r["dryRun"] and r["created"] == 0 and len(r["tasks"]) == 2
    assert client.get(f"/api/plans/{plan_id}/tasks").json() == []  # Vorschau speichert nichts


def test_reimport_updates_and_keeps_progress(client, engine, plan_id):
    _upload(client, plan_id, CSV_DE, "plan.csv")
    with Session(engine) as s:
        task = s.exec(select(PlanTask).where(PlanTask.task_code == "A-130")).first()
        report = DailyReport(project_id=1, report_date=dt.date(2026, 11, 23))
        s.add(report)
        s.commit()
        s.add(ReportProgress(report_id=report.id, task_id=task.id, percent=10))
        s.commit()
        task_id = task.id
    moved = CSV_DE.replace(b"Mo 30.11.26", b"02.12.2026")
    r = _upload(client, plan_id, moved, "plan.csv").json()
    assert (r["created"], r["updated"]) == (0, 2)
    with Session(engine) as s:
        task = s.get(PlanTask, task_id)
        assert task.planned_end == dt.date(2026, 12, 2)
        assert s.exec(select(ReportProgress).where(ReportProgress.task_id == task_id)).first() is not None


def test_pdf_preview_verifies_quotes_and_bulk_saves(client, plan_id, monkeypatch):
    monkeypatch.setattr("src.routers.plan_tasks.extract_pdf_text", lambda data: PDF_TEXT)

    async def fake(system, user, schema, max_tokens=2048):
        T = schema.model_fields["tasks"].annotation.__args__[0]
        return schema(tasks=[
            T(code="A-130", title="Wände Achse A", trade="Rohbau", start="23.11.2026", end="30.11.2026",
              quote="A-130 Wände Achse A 23.11.2026 - 30.11.2026"),
            T(code="X-1", title="Erfunden", trade="", start="01.12.2026", end="05.12.2026",
              quote="X-1 Erfunden 01.12.2026 - 05.12.2026"),  # steht nicht im Plan → verworfen
        ])

    monkeypatch.setattr(llm, "complete_json", fake)
    r = _upload(client, plan_id, b"%PDF-1.7 fake", "plan.pdf", ctype="application/pdf").json()
    assert r["mode"] == "ai" and r["dryRun"] and r["created"] == 0
    assert [t["code"] for t in r["tasks"]] == ["A-130"] and "Erfunden" in r["warnings"][0]
    assert client.get(f"/api/plans/{plan_id}/tasks").json() == []  # PDF immer nur Vorschau

    saved = client.post(f"/api/plans/{plan_id}/tasks/bulk", json={"tasks": r["tasks"]}).json()
    assert saved["created"] == 1 and len(client.get(f"/api/plans/{plan_id}/tasks").json()) == 1


def test_pdf_offline_regex(client, plan_id, monkeypatch):
    monkeypatch.setattr("src.routers.plan_tasks.extract_pdf_text", lambda data: PDF_TEXT)
    r = _upload(client, plan_id, b"%PDF-1.7 fake", "plan.pdf", ctype="application/pdf").json()
    assert r["mode"] == "offline"
    assert [(t["code"], t["title"], t["end"]) for t in r["tasks"]] == [
        ("A-130", "Wände Achse A", "2026-11-30"), ("B-210", "Fundamente Achse B", "2026-11-27")]


def test_task_crud_and_delete_protection(client, engine, plan_id):
    body = {"task_code": "Z-1", "title": "Gerüst", "trade": "Gerüstbau",
            "planned_start": "2026-11-23", "planned_end": "2026-11-24"}
    task = client.post(f"/api/plans/{plan_id}/tasks", json=body).json()
    assert client.post(f"/api/plans/{plan_id}/tasks", json={**body, "planned_end": "2026-11-01"}).status_code == 422
    assert client.patch(f"/api/plans/{plan_id}/tasks/{task['id']}", json={"trade": "Gerüst"}).json()["trade"] == "Gerüst"
    with Session(engine) as s:
        report = DailyReport(project_id=1, report_date=dt.date(2026, 11, 23))
        s.add(report)
        s.commit()
        s.add(ReportProgress(report_id=report.id, task_id=task["id"], percent=50))
        s.commit()
    assert client.delete(f"/api/plans/{plan_id}/tasks/{task['id']}").status_code == 409
    assert client.delete(f"/api/plans/{plan_id}/tasks/{task['id']}?force=true").status_code == 204
    assert client.get(f"/api/plans/{plan_id}/tasks").json() == []


def test_errors(client, plan_id):
    assert _upload(client, 999, CSV_EN, "plan.csv").status_code == 404
    assert _upload(client, plan_id, b"PK\x03\x04", "plan.xlsx", ctype="application/vnd.ms-excel").status_code == 415
    assert _upload(client, plan_id, b"", "plan.csv").status_code == 422
    r = _upload(client, plan_id, b"foo;bar\n1;2\n", "plan.csv")
    assert r.status_code == 422 and "Spalten nicht erkannt" in r.json()["detail"]
    big = b"Nr;Vorgang;Anfang;Ende\n" + b"x" * (5 * 1024 * 1024)
    assert _upload(client, plan_id, big, "plan.csv").status_code == 413
    assert client.patch(f"/api/plans/{plan_id}/tasks/12345", json={"title": "x"}).status_code == 404


def test_parse_date_formats():
    d = dt.date(2026, 11, 23)
    assert [plan_import.parse_date(v) for v in ("23.11.2026", "23.11.26", "Mo 23.11.26", "2026-11-23")] == [d] * 4
    assert plan_import.parse_date("31.02.2026") is None and plan_import.parse_date("") is None

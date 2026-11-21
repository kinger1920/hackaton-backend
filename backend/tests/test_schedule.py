"""Tests für GET /api/schedule (Tagesaufgaben + Termine) und GET /api/timeline – Seed-Daten, ohne Netz/KI."""

import datetime as dt
import importlib.util
from pathlib import Path

import pytest
from sqlmodel import Session

from src.models import FormalNotice, NoticeDraftData, Project, SiteNote

_SEED = Path(__file__).resolve().parent.parent / "scripts" / "seed_reports.py"
_spec = importlib.util.spec_from_file_location("seed_reports", _SEED)
seed_reports = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seed_reports)


@pytest.fixture
def pid(engine) -> int:
    with Session(engine) as s:
        p = Project(name="Schulzentrum")
        s.add(p)
        s.commit()
        seed_reports.seed_all(s, p)
        seed_reports.seed_companies(s, p)
        s.commit()
        return p.id


def _schedule(client, pid, start, days=7, ref=None):
    return client.get(f"/api/schedule?project_id={pid}&from={start}&days={days}&ref_date={ref or start}").json()


def _codes(day):
    return {t["code"]: t for t in day["tasks"]}


# ---------------------------------------------------------------- Tagesaufgaben

def test_daily_tasks_follow_plan_with_firm_and_target(client, pid):
    d = _schedule(client, pid, "2026-11-16", days=7)
    days = {x["date"]: x for x in d["days"]}
    assert list(days) == ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]  # nur Werktage
    b200 = _codes(days["2026-11-16"])["B-200"]
    assert b200["isStart"] and b200["company"] == "Erdbau Krause GmbH" and b200["plannedWorkforce"] == 3
    assert b200["planPercent"] == 25 and b200["source"] == "Bauzeitenplan Rohbau v1.0"
    assert _codes(days["2026-11-19"])["B-200"]["isEnd"]


def test_unfinished_task_stays_as_overdue(client, pid):
    days = {x["date"]: x for x in _schedule(client, pid, "2026-11-20", days=4)["days"]}
    late = _codes(days["2026-11-20"])["B-200"]
    assert late["isOverdue"] and late["actualPercent"] == 55 and late["status"] == "delayed"
    assert set(_codes(days["2026-11-23"])) == {"B-200", "A-130", "B-210"}


def test_appointments_in_site_appointment_format(client, pid):
    appts = {a["id"]: a for a in _schedule(client, pid, "2026-11-20")["appointments"]}
    late = next(a for a in appts.values() if a["title"] == "Verzug: Aushub Achse B")
    assert late["category"] == "deadline" and late["isUrgent"] and late["date"] == "2026-11-20"
    assert "1,8 AT Verzug" in late["description"] and late["vobReference"] == "§ 6 Abs. 1 VOB/B"
    starts = [a for a in appts.values() if a["category"] == "milestone" and a["date"] == "2026-11-23"]
    assert {a["title"] for a in starts} == {"Beginn: Wände Achse A", "Beginn: Fundamente Achse B"}
    assert set(late) >= {"id", "projectId", "title", "date", "time", "category", "trade", "description",
                         "vobReference", "isUrgent"}


def test_workforce_suggestion_until_notice_exists(client, engine, pid):
    def suggestions():
        return [a for a in _schedule(client, pid, "2026-11-18", days=3)["appointments"]
                if a["id"].startswith("workforce-")]

    found = suggestions()
    assert found and found[0]["isUrgent"] and found[0]["title"].startswith("Behinderungsanzeige prüfen")
    with Session(engine) as s:  # Bauleiter hat reagiert → Hinweis verschwindet
        s.add(FormalNotice(project_id=pid, type="delay", body="…",
                           created_at=dt.datetime(2026, 11, 18, 15, 0, tzinfo=dt.timezone.utc)))
        s.commit()
    assert suggestions() == []


# ---------------------------------------------------------------- Timeline

def _timeline(client, pid, start, end, types=None):
    url = f"/api/timeline?project_id={pid}&from={start}&to={end}" + (f"&types={types}" if types else "")
    return client.get(url)


def test_timeline_reports_progress_alerts_newest_first(client, pid):
    items = _timeline(client, pid, "2026-11-16", "2026-11-20").json()["items"]
    dates = [i["date"] for i in items]
    assert dates == sorted(dates, reverse=True)
    titles = [(i["date"], i["type"], i["title"]) for i in items]
    assert ("2026-11-17", "progress", "Aushub Achse B: 25 % → 30 %") in titles
    assert ("2026-11-20", "progress", "Aushub Achse B: 30 % → 55 %") in titles
    krause = [t for t in titles if t[2] == "Sollstärke unterschritten: Erdbau Krause GmbH"]
    assert krause == [("2026-11-17", "alert", "Sollstärke unterschritten: Erdbau Krause GmbH")]  # nur Serienbeginn
    assert ("2026-11-18", "alert", "Verzug: Aushub Achse B") in titles
    report = next(i for i in items if i["id"].startswith("report-") and i["date"] == "2026-11-17")
    assert report["severity"] == "warning" and report["source"] == "Tagesbericht 17.11.2026"


def test_timeline_notes_and_notice_approval(client, engine, pid):
    with Session(engine) as s:
        utc = dt.timezone.utc
        s.add(SiteNote(project_id=pid, content="Bagger steht, Pläne fehlen.", category="delay",
                       created_at=dt.datetime(2026, 11, 17, 10, 5, tzinfo=utc)))
        n = FormalNotice(project_id=pid, type="delay", body="…", subject="Behinderungsanzeige Achse B",
                         status="Freigegeben", created_at=dt.datetime(2026, 11, 17, 11, 0, tzinfo=utc))
        s.add(n)
        s.commit()
        s.add(NoticeDraftData(notice_id=n.id, approved_by="Bauleiter",
                              approved_at=dt.datetime(2026, 11, 17, 16, 30, tzinfo=utc)))
        s.commit()
    items = _timeline(client, pid, "2026-11-17", "2026-11-17", "note,notice").json()["items"]
    assert [(i["type"], i["time"], i["title"]) for i in items] == [
        ("notice", "16:30", "Freigegeben: Behinderungsanzeige"),
        ("notice", "11:00", "Entwurf erstellt: Behinderungsanzeige"),
        ("note", "10:05", "Diktat: Behinderung"),
    ]
    assert "Bauleiter" in items[0]["summary"]


def test_timeline_errors(client, pid):
    assert _timeline(client, pid, "2026-11-20", "2026-11-16").status_code == 422
    assert _timeline(client, pid, "2026-01-01", "2026-11-20").status_code == 422  # > 92 Tage
    r = _timeline(client, pid, "2026-11-16", "2026-11-20", "report,photo")
    assert r.status_code == 422 and r.json()["detail"] == {"unknown_types": ["photo"]}
    assert client.get("/api/timeline?project_id=999").status_code == 404
    assert client.get("/api/schedule?project_id=999").status_code == 404


def test_notice_steps_in_same_minute_newest_first(client, engine, pid):
    with Session(engine) as s:
        ts = dt.datetime(2026, 11, 19, 9, 0, tzinfo=dt.timezone.utc)
        n = FormalNotice(project_id=pid, type="defect", body="…", status="Exportiert", created_at=ts, updated_at=ts)
        s.add(n)
        s.commit()
        s.add(NoticeDraftData(notice_id=n.id, approved_by="Bauleiter", approved_at=ts))
        s.commit()
    items = _timeline(client, pid, "2026-11-19", "2026-11-19", "notice").json()["items"]
    assert [i["id"].rsplit("-", 1)[-1] for i in items] == ["exported", "approved", "created"]


# ---------------------------------------------------------------- Manuelle Termine (CRUD + Schedule-Merge + .ics)

def test_manual_appointments_crud_schedule_merge_and_ics(client, pid):
    # Anlegen
    res = client.post("/api/appointments", json={
        "projectId": pid,
        "title": "Baubesprechung Rohbau",
        "date": "2026-11-23",
        "time": "09:30",
        "category": "meeting",
        "trade": "Rohbau",
        "description": "Abstimmung Schalung",
        "vobReference": "§ 4 VOB/B",
        "isUrgent": True,
    })
    assert res.status_code == 201
    created = res.json()
    assert created["id"].startswith("appt-")
    assert created["source"] == "manual" and created["editable"] is True
    assert created["title"] == "Baubesprechung Rohbau" and created["time"] == "09:30"
    numeric_id = int(created["id"].removeprefix("appt-"))

    # In GET /api/appointments gelistet
    listed = client.get(f"/api/appointments?project_id={pid}&from=2026-11-20&to=2026-11-25").json()
    assert [a["id"] for a in listed] == [created["id"]]

    # In GET /api/schedule zusammen mit automatischen Terminen (klar unterscheidbar über source/editable)
    sched_appts = {a["id"]: a for a in _schedule(client, pid, "2026-11-20", days=7)["appointments"]}
    assert created["id"] in sched_appts
    assert sched_appts[created["id"]]["editable"] is True
    auto_plan = next(a for a in sched_appts.values() if a["id"].startswith("task-"))
    assert auto_plan["source"] == "plan" and auto_plan["editable"] is False

    # iCalendar Feed (.ics)
    ics_res = client.get(f"/api/schedule/ics?project_id={pid}&ref_date=2026-11-20")
    assert ics_res.status_code == 200
    assert "BEGIN:VCALENDAR" in ics_res.text
    assert "Baubesprechung Rohbau" in ics_res.text

    # Bearbeiten
    upd = client.patch(f"/api/appointments/{numeric_id}", json={
        "title": "Baubesprechung Rohbau (verschoben)",
        "time": "11:00",
        "isUrgent": False,
    })
    assert upd.status_code == 200
    assert upd.json()["title"] == "Baubesprechung Rohbau (verschoben)"
    assert upd.json()["time"] == "11:00" and upd.json()["isUrgent"] is False

    # Löschen
    assert client.delete(f"/api/appointments/{numeric_id}").status_code == 204
    assert client.get(f"/api/appointments?project_id={pid}").json() == []
    assert client.delete(f"/api/appointments/{numeric_id}").status_code == 404


def test_manual_appointments_validation_errors(client, pid):
    assert client.post("/api/appointments", json={"projectId": pid, "title": "   ", "date": "2026-11-23"}).status_code == 422
    assert client.patch("/api/appointments/99999", json={"title": "Test"}).status_code == 404
    assert client.get(f"/api/appointments?project_id={pid}&from=2026-11-25&to=2026-11-20").status_code == 422


# ---------------------------------------------------------------- Fotos, Versand, Zonen, Dokumente, Profil & Projekt-Delete

def test_photos_upload_describe_list_serve_and_delete(client, pid):
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0"
        b"\x00\x00\x03\x01\x01\x00\x18\xdd\x8d\xb0\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    up = client.post(
        "/api/photos",
        data={"project_id": str(pid), "report_date": "2026-11-20", "caption": "Riss an Schalung Achse B"},
        files={"file": ("riss_achse_b.png", png_bytes, "image/png")},
    )
    assert up.status_code == 201
    photo = up.json()
    assert photo["id"] > 0
    assert photo["report_date"] == "2026-11-20"
    assert "Riss an Schalung Achse B" in photo["caption"]
    assert len(photo["issues"]) >= 1

    # Liste für Tag & Zeitraum
    by_day = client.get(f"/api/photos?project_id={pid}&date=2026-11-20").json()
    assert [p["id"] for p in by_day] == [photo["id"]]
    by_range = client.get(f"/api/photos?project_id={pid}&from=2026-11-18&to=2026-11-21").json()
    assert [p["id"] for p in by_range] == [photo["id"]]

    # Bilddatei abrufen
    file_res = client.get(photo["url"])
    assert file_res.status_code == 200
    assert file_res.content == png_bytes

    # Löschen
    assert client.delete(f"/api/photos/{photo['id']}").status_code == 204
    assert client.get(f"/api/photos?project_id={pid}&date=2026-11-20").json() == []


def test_dispatch_location_documents_profile_and_project_delete(client, pid):
    # 1. Brief anlegen + Versandnachweis speichern
    cap = client.post("/api/capture", json={"text": "Bagger steht seit 10 Uhr wegen fehlender Pläne", "project_id": pid}).json()
    nid = cap["notice_id"]
    assert client.get(f"/api/notices/{nid}/dispatch").json() is None
    disp_payload = {
        "method": "einschreiben",
        "sent_at": "2026-11-20T14:30",
        "tracking_number": "RR-123456789-DE",
        "received_at": "2026-11-21",
    }
    saved_disp = client.put(f"/api/notices/{nid}/dispatch", json=disp_payload)
    assert saved_disp.status_code == 200
    assert client.get(f"/api/notices/{nid}/dispatch").json()["tracking_number"] == "RR-123456789-DE"

    # 2. Bereich/Zone am Vorgang speichern und in /api/analysis prüfen
    analysis = client.get(f"/api/analysis?project_id={pid}&period=all&ref_date=2026-11-20").json()
    wp = analysis["workPackages"][0]
    assert wp["taskId"] is not None and wp["planId"] is not None
    patched_task = client.patch(
        f"/api/plans/{wp['planId']}/tasks/{wp['taskId']}",
        json={"location": "Bauteil C / 2. OG"},
    )
    assert patched_task.status_code == 200
    assert patched_task.json()["location"] == "Bauteil C / 2. OG"
    analysis_after = client.get(f"/api/analysis?project_id={pid}&period=all&ref_date=2026-11-20").json()
    assert analysis_after["workPackages"][0]["location"] == "Bauteil C / 2. OG"

    # 3. Projektdokumente & Bauleiter-Profil
    docs = client.get(f"/api/documents?project_id={pid}").json()
    assert len(docs) >= 2  # Standard-Protokoll + Standard-E-Mail geseedet
    new_doc = client.post("/api/documents", json={
        "projectId": pid,
        "type": "minutes",
        "title": "Sonderbesprechung Kranstandort",
        "date": "21.11.2026",
        "authorOrSender": "Bauleitung",
        "content": "Kran 2 bleibt bis Ende Dezember.",
    })
    assert new_doc.status_code == 201

    prof = client.put("/api/profile", json={
        "fullName": "Dipl.-Ing. Anna Baustark",
        "email": "a.baustark@bau-ag.de",
        "phone": "+49 171 9998877",
        "company": "Baupartner AG",
        "role": "Oberbauleiter",
        "officeLocation": "Berlin",
        "workplaceType": "Baustellencontainer vor Ort",
        "permissions": {"dailyReports": True, "vobLetters": True, "defectNotices": True, "claims": True},
    })
    assert prof.status_code == 200
    assert client.get("/api/profile").json()["fullName"] == "Dipl.-Ing. Anna Baustark"

    # 4. Termin + Foto für das Projekt anlegen und dann Projekt komplett löschen (Foreign-Key-Check!)
    client.post("/api/appointments", json={"projectId": pid, "title": "Abnahme", "date": "2026-11-25", "category": "inspection"})
    client.post(
        "/api/photos",
        data={"project_id": str(pid), "report_date": "2026-11-20"},
        files={"file": ("test.jpg", b"\xff\xd8\xff\xe0\x00\x10JFIF", "image/jpeg")},
    )
    del_res = client.delete(f"/projects/{pid}")
    assert del_res.status_code == 204


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

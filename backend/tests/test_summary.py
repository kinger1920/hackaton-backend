"""Tests für POST /api/summarize (offline, ohne Tokenverbrauch; LLM-Pfad mit Mock)."""

import datetime as dt
import json

import pytest
from sqlmodel import Session

from src.models import DailyReport, FormalNotice, Project
from src.services import llm, summary


def _seed(engine) -> int:
    """Projekt mit 3 Berichten in KW 47 (16.–22.11.2026), einer davon mit kaputtem JSON, + 1 Entwurf."""
    with Session(engine) as s:
        p = Project(name="Wohnpark Nord", client="Stadt Berlin")
        s.add(p)
        s.commit()
        s.refresh(p)
        crew = json.dumps([{"trade": "Rohbau", "workers": 8, "hours": 64}])
        s.add(DailyReport(project_id=p.id, report_date=dt.date(2026, 11, 16), workforce=crew,
                          weather=json.dumps({"condition": "bewölkt", "rain_mm": 0}),
                          work_completed="Aushub Achse B begonnen."))
        s.add(DailyReport(project_id=p.id, report_date=dt.date(2026, 11, 17), workforce=crew,
                          weather=json.dumps({"condition": "Regen", "rain_mm": 4}),
                          deviations_incidents="Bagger steht seit 10 Uhr, Leitungspläne fehlen."))
        s.add(DailyReport(project_id=p.id, report_date=dt.date(2026, 11, 18), workforce="{kaputt",
                          weather="kein json"))
        # Bericht außerhalb des Zeitraums – darf nicht auftauchen
        s.add(DailyReport(project_id=p.id, report_date=dt.date(2026, 11, 9), work_completed="Alte Woche."))
        s.add(FormalNotice(project_id=p.id, type="delay", body="...", subject="Behinderung Achse B",
                           created_at=dt.datetime(2026, 11, 17, 12, 0, tzinfo=dt.timezone.utc)))
        s.commit()
        return p.id


# ---------------------------------------------------------------- Einheiten

@pytest.mark.parametrize("period,ref,expected", [
    ("week", dt.date(2026, 11, 18), (dt.date(2026, 11, 16), dt.date(2026, 11, 22))),
    ("week", dt.date(2026, 11, 16), (dt.date(2026, 11, 16), dt.date(2026, 11, 22))),
    ("month", dt.date(2026, 11, 18), (dt.date(2026, 11, 1), dt.date(2026, 11, 30))),
    ("month", dt.date(2028, 2, 10), (dt.date(2028, 2, 1), dt.date(2028, 2, 29))),
])
def test_resolve_period(period, ref, expected):
    assert summary.resolve_period(period, ref) == expected


def test_compute_stats_tolerates_broken_json():
    reports = [
        DailyReport(project_id=1, report_date=dt.date(2026, 11, 16),
                    workforce=json.dumps([{"workers": 8, "hours": 64}, {"workers": 2, "hours": 16}]),
                    weather=json.dumps({"rain_mm": 3})),
        DailyReport(project_id=1, report_date=dt.date(2026, 11, 17), workforce="{kaputt",
                    weather="nein", deviations_incidents="Stillstand"),
    ]
    stats = summary.compute_stats(reports, [])
    assert stats.reportDays == 2
    assert stats.workforceHours == 80
    assert stats.avgWorkers == 10  # nur der Tag mit gültigem JSON zählt
    assert stats.rainDays == 1
    assert stats.incidentDays == 1


# ---------------------------------------------------------------- API, offline

def test_week_offline(client, engine):
    pid = _seed(engine)
    r = client.post("/api/summarize", json={"project_id": pid, "period": "week", "ref_date": "2026-11-18"})
    assert r.status_code == 200
    data = r.json()
    assert data["mode"] == "offline"
    assert data["periodFrom"] == "2026-11-16" and data["periodTo"] == "2026-11-22"
    assert "KW 47" in data["title"]
    assert data["stats"]["reportDays"] == 3
    assert data["stats"]["rainDays"] == 1
    assert data["stats"]["noticesByStatus"] == {"Entwurf": 1}
    assert "Tagesbericht 09.11.2026" not in data["sources"]

    risk = data["vobRisks"][0]
    assert risk["source"] == "Tagesbericht 17.11.2026"
    assert risk["linkType"] == "delay"
    assert "§ 6" in risk["recommendation"]

    action = data["actionItems"][0]
    assert action["source"].startswith("Schreiben #")
    assert action["priority"] == "Hoch" and action["done"] is False
    assert data["keyDecisions"] == [] and data["keyDecisionSources"] == []


def test_empty_period_skips_llm(client, engine, monkeypatch):
    pid = _seed(engine)

    async def boom(*a, **kw):
        raise AssertionError("LLM darf bei leerem Zeitraum nicht aufgerufen werden")

    monkeypatch.setattr(llm, "complete_json", boom)
    r = client.post("/api/summarize", json={"project_id": pid, "period": "month", "ref_date": "2026-01-15"})
    assert r.status_code == 200
    assert "Keine Einträge" in r.json()["executiveSummary"][0]
    assert r.json()["stats"]["reportDays"] == 0


def test_text_offline(client):
    text = ("Sehr geehrte Damen und Herren, die Leitungspläne fehlen weiterhin. "
            "Bitte liefern Sie die Pläne bis 19.11. nach. Der Bagger steht still.")
    r = client.post("/api/summarize", json={"text": text, "source_type": "emails"})
    assert r.status_code == 200
    data = r.json()
    assert data["mode"] == "offline"
    assert data["sources"] == ["E-Mail"]
    assert any("bis 19.11." in a["task"] for a in data["actionItems"])
    assert data["vobRisks"][0]["linkType"] == "delay"
    assert data["periodFrom"] is None and data["stats"] is None


@pytest.mark.parametrize("body", [
    {},
    {"text": "abc", "project_id": 1, "period": "week"},
    {"period": "week"},
    {"text": "   "},
])
def test_invalid_mode_422(client, body):
    assert client.post("/api/summarize", json=body).status_code == 422


def test_unknown_project_404(client):
    r = client.post("/api/summarize", json={"project_id": 999, "period": "week"})
    assert r.status_code == 404


# ---------------------------------------------------------------- API, LLM gemockt

def test_llm_items_with_unknown_source_are_dropped(client, engine, monkeypatch):
    pid = _seed(engine)
    seen = {}

    async def fake(system, user, schema, max_tokens=2048):
        seen["context"] = user
        return schema(
            executiveSummary=["Aushub Achse B wegen fehlender Pläne gestoppt."],
            keyDecisions=[{"text": "Erfundene Entscheidung", "source": "Protokoll 01.01.2026"}],
            actionItems=[
                {"task": "Leitungspläne anfordern", "responsible": "", "deadline": "", "priority": "Hoch",
                 "source": "[Tagesbericht 17.11.2026]"},
                {"task": "Erfunden", "responsible": "", "deadline": "", "priority": "Normal",
                 "source": "Tagesbericht 01.01.2026"},
            ],
            vobRisks=[{"title": "Behinderung", "description": "Stillstand Bagger", "linkType": "delay",
                       "source": "Tagesbericht 17.11.2026"}],
        )

    monkeypatch.setattr(llm, "complete_json", fake)
    r = client.post("/api/summarize", json={"project_id": pid, "period": "week", "ref_date": "2026-11-18"})
    data = r.json()
    assert data["mode"] == "ai"
    assert "[Tagesbericht 17.11.2026]" in seen["context"]
    assert data["executiveSummary"][0].startswith("3 Berichtstage")  # Kennzahlen aus Code zuerst
    assert data["keyDecisions"] == []  # erfundene Quelle verworfen
    assert [a["task"] for a in data["actionItems"]] == ["Leitungspläne anfordern"]
    assert data["actionItems"][0]["source"] == "Tagesbericht 17.11.2026"  # Klammern entfernt
    assert data["vobRisks"][0]["recommendation"] == summary.RECOMMENDATIONS["delay"]


BUG_TEXT = ("Baubesprechung 21.11.: Firma Müller Rohbau war heute nur mit 3 statt 12 Leuten vor Ort. "
            "Beschluss: Architekt liefert die fehlenden Schalpläne bis 28.11.2026. "
            "Bauleitung prüft eine Behinderungsanzeige.")


@pytest.mark.parametrize("source_type,label", [(None, "Text"), ("minutes", "Protokoll")])
def test_text_mode_keeps_items_when_llm_names_content_as_source(client, monkeypatch, source_type, label):
    """Bug: KI nannte 'Baubesprechung 21.11.' statt 'Text' als Quelle → alle Listen waren leer."""
    src = "Baubesprechung 21.11."

    async def fake(system, user, schema, max_tokens=2048):
        return schema(
            executiveSummary=["Müller Rohbau unterbesetzt, Schalpläne fehlen."],
            keyDecisions=[{"text": "Architekt liefert Schalpläne bis 28.11.2026", "source": src}],
            actionItems=[{"task": "Schalpläne liefern", "responsible": "Architekt", "deadline": "28.11.2026",
                          "priority": "Hoch", "source": src}],
            vobRisks=[
                {"title": "Unterbesetzung", "description": "3 statt 12", "linkType": "delay", "source": src},
                {"title": "Fehlende Pläne", "description": "Schalpläne", "linkType": "delay", "source": src},
            ],
        )

    monkeypatch.setattr(llm, "complete_json", fake)
    body = {"text": BUG_TEXT} | ({"source_type": source_type} if source_type else {})
    data = client.post("/api/summarize", json=body).json()
    assert data["mode"] == "ai"
    assert (len(data["keyDecisions"]), len(data["actionItems"]), len(data["vobRisks"])) == (1, 1, 2)
    assert data["keyDecisionSources"] == [label]
    assert {data["actionItems"][0]["source"], *(r["source"] for r in data["vobRisks"])} == {label}

"""Tests: Anwesenheit je Firma/Gewerk + Sollstärke-Check → Vorschlag Behinderungsanzeige (ohne Netz, ohne KI)."""

import datetime as dt
import importlib.util
import io
from pathlib import Path

import pytest
from docx import Document
from sqlmodel import Session

from src.models import Project
from src.services import llm
from src.services.workforce import workforce_check

_SEED = Path(__file__).resolve().parent.parent / "scripts" / "seed_reports.py"
_spec = importlib.util.spec_from_file_location("seed_reports", _SEED)
seed_reports = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seed_reports)


@pytest.fixture
def pid(engine) -> int:
    with Session(engine) as s:
        p = Project(name="Schulzentrum", number="PRJ-1")
        s.add(p)
        s.commit()
        seed_reports.seed_all(s, p)
        seed_reports.seed_companies(s, p)
        s.commit()
        return p.id


def _check(engine, pid, day):
    with Session(engine) as s:
        return workforce_check(s, s.get(Project, pid), dt.date.fromisoformat(day))


def test_report_returns_attendance_and_temperature(client, pid):
    data = client.get(f"/api/reports/2026-11-17?project_id={pid}").json()
    assert data["weather"] == "bewölkt" and data["temperature_c"] == 6
    assert {(a["company"], a["workers"]) for a in data["attendance"]} == {
        ("Erdbau Krause GmbH", 1), ("BetonTech Rohbau GmbH", 4)}


def test_put_attendance_sums_workforce_and_none_keeps_it(client, pid):
    url = f"/api/reports/2026-11-23?project_id={pid}"
    body = {"weather": "sonnig", "temperature_c": 4.5, "site_manager": "M. Weber",
            "attendance": [{"company": "Erdbau Krause GmbH", "trade": "Erdbau", "workers": 3},
                           {"company": "BetonTech Rohbau GmbH", "trade": "Rohbau", "workers": 7}]}
    data = client.put(url, json=body).json()
    assert data["workforce_count"] == 10 and data["temperature_c"] == 4.5 and data["site_manager"] == "M. Weber"
    # Altes Frontend schickt keine Anwesenheit → bleibt erhalten.
    data = client.put(url, json={"weather": "sonnig", "workforce_count": 10}).json()
    assert len(data["attendance"]) == 2


def test_no_gap_on_normal_day(engine, pid):
    assert _check(engine, pid, "2026-11-16") == []


def test_first_day_warns_without_suggestion(engine, pid):
    gaps = {g.company: g for g in _check(engine, pid, "2026-11-17")}
    erdbau = gaps["Erdbau Krause GmbH"]
    assert (erdbau.planned, erdbau.actual, erdbau.shortfallPercent, erdbau.consecutiveDays) == (3, 1, 67, 1)
    assert erdbau.suggestion is None
    assert erdbau.source == "Tagesbericht 17.11.2026"


def test_second_day_suggests_notice_with_facts_and_hints(engine, pid):
    erdbau = next(g for g in _check(engine, pid, "2026-11-18") if g.company == "Erdbau Krause GmbH")
    assert erdbau.consecutiveDays == 2
    s = erdbau.suggestion
    assert s is not None and s.draftType == "delay"
    assert "17.11.2026: 1" in s.prefillText and "18.11.2026: 1" in s.prefillText
    assert "Sollstärke von 3" in s.prefillText and "fehlender Leitungspläne" in s.prefillText
    assert any(h.startswith("§ 6 Abs. 1 VOB/B") for h in erdbau.vobHints)
    assert any("binnen 2 Arbeitstagen" in h for h in erdbau.vobHints)  # Vertragsbesonderheit


def test_no_attendance_means_no_comparison(client, engine, pid):
    client.put(f"/api/reports/2026-11-24?project_id={pid}", json={"workforce_count": 2})
    assert _check(engine, pid, "2026-11-24") == []


def test_dashboard_puts_suggestion_first(client, pid):
    alerts = client.get(f"/api/dashboard?project_id={pid}&ref_date=2026-11-18").json()["alerts"]
    assert alerts[0]["severity"] == "critical" and alerts[0]["draftType"] == "delay"
    assert alerts[0]["prefillText"].startswith("Personalunterschreitung")


def test_day_analysis_lists_company_shortfall(client, pid):
    data = client.get(f"/api/reports/2026-11-18/analysis?project_id={pid}").json()
    bad = [i["text"] for i in data["wentBadly"]]
    assert any(t.startswith("Erdbau Krause GmbH: 1 statt 3") and "2. Tag in Folge" in t for t in bad)
    assert not any(t.startswith("Personal unter Soll") for t in bad)  # ersetzt durch Firmen-Vergleich
    assert len(data["workforce"]) == 2


def test_suggestion_creates_draft_via_capture(client, engine, pid):
    erdbau = next(g for g in _check(engine, pid, "2026-11-18") if g.company == "Erdbau Krause GmbH")
    r = client.post("/api/capture", json={"text": erdbau.suggestion.prefillText, "lang": "de",
                                          "force_type": "delay", "project_id": pid})
    assert r.status_code == 200


@pytest.mark.parametrize("text,lang", [
    ("Fa. Krause heute nur 2 Mann, BetonTech mit 8 Leuten.", "de"),
    ("Dziś firma Krause tylko 2 osoby. BetonTech ma 8 ludzi.", "pl"),
])
def test_offline_fill_reads_attendance(client, pid, text, lang):
    data = client.post("/api/reports/2026-11-23/fill", json={"text": text, "lang": lang, "project_id": pid}).json()
    assert data["mode"] == "offline"
    assert {(a["company"], a["workers"]) for a in data["attendance"]} == {
        ("Erdbau Krause GmbH", 2), ("BetonTech Rohbau GmbH", 8)}
    assert data["workforce_count"] == 10


def test_ai_fill_attendance_is_validated(client, pid, monkeypatch):
    async def fake(system, user, schema, max_tokens=2048):
        assert "Erdbau Krause GmbH (Erdbau)" in user  # Firmenliste geht an die KI
        return schema(work_completed="", deviations_incidents="", deliveries="", weather="", temperature_c="7",
                      workforce_count="", trades=[], progress=[],
                      attendance=[{"company": "Krause", "trade": "", "workers": 2},
                                  {"company": "Phantom", "trade": "", "workers": 9999}])  # Unsinn → verworfen

    monkeypatch.setattr(llm, "complete_json", fake)
    data = client.post("/api/reports/2026-11-23/fill", json={"text": "x", "project_id": pid}).json()
    assert [(a["company"], a["workers"]) for a in data["attendance"]] == [("Erdbau Krause GmbH", 2)]
    assert data["temperature_c"] == 7


def test_export_has_attendance_table(client, pid):
    content = client.get(f"/api/reports/2026-11-18/docx?project_id={pid}").content
    doc = Document(io.BytesIO(content))
    text = "\n".join([p.text for p in doc.paragraphs] +
                     [c.text for t in doc.tables for row in t.rows for c in row.cells])
    assert "Anwesenheit je Firma / Gewerk" in text and "Erdbau Krause GmbH" in text
    assert "sonnig, 5 °C" in text  # Wetter inkl. Temperatur


def _add_mueller(engine, pid):
    """Zweite Rohbau-Firma wie in Yannicks Testdaten – macht das Gewerk mehrdeutig."""
    from src.models import Contract

    with Session(engine) as s:
        s.add(Contract(project_id=pid, title="NU Rohbau Müller", contractor_name="Müller Rohbau GmbH",
                       trade="Rohbau", planned_workforce=8))
        s.commit()


def test_matching_ignores_trade_words_and_ambiguous_trades(engine, pid):
    from sqlmodel import select

    from src.models import Contract
    from src.schemas.reports import AttendanceItem
    from src.services.workforce import match_contract

    _add_mueller(engine, pid)
    with Session(engine) as s:
        contracts = list(s.exec(select(Contract)).all())
    name = lambda item: (c := match_contract(item, contracts)) and c.contractor_name  # noqa: E731
    assert name(AttendanceItem(company="BetonTech Rohbau", workers=8)) == "BetonTech Rohbau GmbH"
    assert name(AttendanceItem(company="Fa. Müller", workers=8)) == "Müller Rohbau GmbH"
    assert name(AttendanceItem(trade="Rohbau", workers=8)) is None  # zwei Rohbau-Firmen → nicht raten
    assert name(AttendanceItem(trade="Erdbau", workers=3)) == "Erdbau Krause GmbH"


def test_absent_firm_counts_only_when_its_trade_is_scheduled(client, engine, pid):
    _add_mueller(engine, pid)
    beton_only = {"attendance": [{"company": "BetonTech Rohbau GmbH", "trade": "Rohbau", "workers": 8}]}
    # 25.11.: laut Plan nur Rohbau aktiv → fehlende Erdbaufirma ist kein Fehlbestand; Müller fehlt,
    # aber BetonTech (gleiches Gewerk) ist da → nicht eindeutig → keine Warnung.
    client.put(f"/api/reports/2026-11-25?project_id={pid}", json=beton_only)
    assert _check(engine, pid, "2026-11-25") == []
    # 19.11.: Erdbau laut Plan aktiv (Aushub Achse B), Krause fehlt ganz → 0 statt 3.
    client.put(f"/api/reports/2026-11-19?project_id={pid}", json=beton_only)
    gaps = {g.company: g for g in _check(engine, pid, "2026-11-19")}
    assert set(gaps) == {"Erdbau Krause GmbH"} and gaps["Erdbau Krause GmbH"].actual == 0

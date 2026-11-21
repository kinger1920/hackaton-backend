"""Demo-Reset für die Jury (Contract: POST /api/demo/reset → {ok}).

Ablauf: komplette Datenbank leeren → festen Demo-Stand laden (Projekt mit Stammdaten, Firmen +
Verträge mit Sollstärke, Bauzeitenplan, 15 Tagesberichte, Fortschritt, zwei Diktate).
Die Story liegt im Seed auf 02.–20.11.2026; beim Reset wird sie um ganze WERKTAGE verschoben,
sodass der letzte Bericht auf dem letzten Werktag vor dem Stichtag liegt (Wochentage und
Vorgangsdauern bleiben stimmig, Datumsangaben im Text wandern mit).
Hochgeladene Dateien (data/uploads) bleiben auf der Platte – sie werden nur nicht mehr referenziert.
"""

import datetime as dt
import importlib.util
from pathlib import Path

from sqlmodel import Session, SQLModel, select

from src.models import Contract, DailyReport, PlanTask, Project, SiteNote

_SEED_FILE = Path(__file__).resolve().parents[2] / "scripts" / "seed_reports.py"
SEED_LAST_DAY = dt.date(2026, 11, 20)  # letzter Berichtstag der Seed-Story (Freitag)

DEMO_PROJECT = dict(
    name="Neubau Schulzentrum Nord (Haus B & C)", number="PRJ-2026-084", client="Bezirksamt Pankow",
    location="Berliner Str. 42, 10115 Berlin", phase="Rohbau", status="Aktiv",
    description="Neubau zweier Schulgebäude in Massivbauweise, 3 Geschosse, Tiefgarage.",
    construction_volume_eur=18_500_000, budget_eur=17_200_000, gross_floor_area_m2=9_400,
    gross_volume_m3=38_000, construction_type="Stahlbeton-Massivbau", contract_type="Einheitspreisvertrag",
    vob_b_agreed=True, vob_notes="VOB/B 2016 vereinbart; Behinderungen binnen 2 Arbeitstagen schriftlich anzeigen.",
)
# (Seed-Datum, Uhrzeit UTC, Kategorie, Text) – zeigt in der Timeline Diktate in DE und PL.
DEMO_NOTES = [
    ("2026-11-17", "09:12", "delay", "Bagger steht an Achse B, die Leitungspläne vom Bauherrn fehlen. Gasleitung unklar."),
    ("2026-11-18", "07:45", "delay", "Dzisiaj z firmy Krause tylko jedna osoba, koparka dalej stoi – brak planów."),
]


def _seed_module():
    spec = importlib.util.spec_from_file_location("seed_reports", _SEED_FILE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def last_workday_before(day: dt.date) -> dt.date:
    d = day - dt.timedelta(days=1)
    while d.weekday() >= 5:
        d -= dt.timedelta(days=1)
    return d


def add_workdays(day: dt.date, n: int) -> dt.date:
    """n Werktage (Mo–Fr) vor/zurück; ein Werktag bleibt ein Werktag."""
    step = 1 if n >= 0 else -1
    d = day
    for _ in range(abs(n)):
        d += dt.timedelta(days=step)
        while d.weekday() >= 5:
            d += dt.timedelta(days=step)
    return d


def workday_offset(target: dt.date) -> int:
    """Wie viele Werktage muss SEED_LAST_DAY verschoben werden, um auf `target` (Werktag) zu landen?"""
    n, d = 0, SEED_LAST_DAY
    step = 1 if target >= d else -1
    while d != target:
        d = add_workdays(d, step)
        n += step
    return n


def wipe(session: Session) -> None:
    """Alle Tabellen leeren – Kind-Tabellen zuerst (Fremdschlüssel)."""
    for table in reversed(SQLModel.metadata.sorted_tables):
        session.execute(table.delete())
    session.flush()


def reset(session: Session, ref: dt.date) -> dict:
    """DB leeren + Demo laden, bezogen auf den Stichtag `ref`. Rückgabe: Kennzahlen für die Antwort."""
    seed = _seed_module()
    offset = workday_offset(last_workday_before(ref))
    shift = (lambda d: add_workdays(d, offset)) if offset else seed._same

    wipe(session)
    project = Project(**DEMO_PROJECT, start_date=shift(dt.date(2026, 11, 2)),
                      end_date=add_workdays(shift(dt.date(2026, 11, 2)), 160))
    session.add(project)
    session.flush()
    seed.seed_companies(session, project)
    seed.seed_all(session, project, shift)
    for day, time, category, text in DEMO_NOTES:
        d = shift(dt.date.fromisoformat(day))
        hh, mm = map(int, time.split(":"))
        session.add(SiteNote(project_id=project.id, content=text, category=category, status="incorporated",
                             created_at=dt.datetime(d.year, d.month, d.day, hh, mm, tzinfo=dt.timezone.utc)))
    session.commit()

    count = lambda model, col: len(session.exec(select(model).where(col == project.id)).all())  # noqa: E731
    return {
        "ok": True, "project_id": project.id, "reports": count(DailyReport, DailyReport.project_id),
        "contracts": count(Contract, Contract.project_id), "tasks": len(session.exec(select(PlanTask)).all()),
        "notes": count(SiteNote, SiteNote.project_id), "last_report_date": shift(SEED_LAST_DAY).isoformat(),
        "shifted_workdays": offset,
    }

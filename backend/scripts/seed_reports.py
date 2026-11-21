"""Legt Demo-Daten an: Bauzeitenplan + Tagesberichte (Werktage 02.11.–20.11.2026) + Fortschritt je Vorgang.

Genutzt von /api/summarize, /api/reports und der Soll/Ist-Analyse.

Aufruf:  cd backend && DATABASE_URL=sqlite:///pfad/zur/kopie.db uv run python scripts/seed_reports.py [--project-id 1]

ACHTUNG: Ohne DATABASE_URL schreibt das Skript in die getrackte `data/site_assistant.db`.
Diese Änderung NICHT committen (Datenbank gehört Yannick, Seed/Reset ist sein Bereich).

Idempotent: Vorhandene Pläne/Vorgänge/Berichte werden wiederverwendet, nur Fehlendes ergänzt.
Die Story: normaler Rohbau-Fortschritt, Regentag am 10.11., verspätete Betonlieferung am 12.11.,
Behinderung durch fehlende Leitungspläne vom 17.–19.11., Freigabe der Pläne am 20.11.
Ergebnis für die Analyse am 20.11.: "Aushub Achse B" Soll 100 % / Ist 55 % bei 4 Werktagen → 1,8 Tage Verzug.
"""

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # damit `src` importierbar ist

from sqlmodel import Session, select  # noqa: E402

from src.database import engine, init_db  # noqa: E402
from src.models import ConstructionPlan, DailyReport, PlanTask, Project, ReportProgress  # noqa: E402

CREW_NORMAL = [{"trade": "Erdbau", "workers": 3, "hours": 24}, {"trade": "Rohbau", "workers": 8, "hours": 64}]
CREW_REDUCED = [{"trade": "Erdbau", "workers": 1, "hours": 8}, {"trade": "Rohbau", "workers": 4, "hours": 32}]
EQUIP = [{"machine": "Bagger CAT 320", "hours": 7}, {"machine": "Kran 1", "hours": 6}]

# Datum → (Wetter, Personal, Ausgeführte Arbeiten, Vorkommnisse)
DAYS: dict[str, tuple[dict, list, str, str]] = {
    "2026-11-02": ({"condition": "bewölkt", "temp_c": 8, "rain_mm": 0}, CREW_NORMAL,
                   "Baustelleneinrichtung abgeschlossen, Aushub Baugrube Achse A begonnen.", ""),
    "2026-11-03": ({"condition": "sonnig", "temp_c": 10, "rain_mm": 0}, CREW_NORMAL,
                   "Aushub Achse A fortgesetzt, ca. 120 m³ abgefahren.", ""),
    "2026-11-04": ({"condition": "bewölkt", "temp_c": 9, "rain_mm": 0}, CREW_NORMAL,
                   "Aushub Achse A abgeschlossen, Verbau Nordseite gestellt.", ""),
    "2026-11-05": ({"condition": "bewölkt", "temp_c": 7, "rain_mm": 0}, CREW_NORMAL,
                   "Sauberkeitsschicht Achse A betoniert.", ""),
    "2026-11-06": ({"condition": "sonnig", "temp_c": 8, "rain_mm": 0}, CREW_NORMAL,
                   "Schalung Fundamente Achse A, Bewehrung angeliefert.", ""),
    "2026-11-09": ({"condition": "bewölkt", "temp_c": 6, "rain_mm": 0}, CREW_NORMAL,
                   "Bewehrung Fundamente Achse A verlegt, Abnahme durch Statiker für 12.11. vereinbart.", ""),
    "2026-11-10": ({"condition": "Starkregen", "temp_c": 5, "rain_mm": 22}, CREW_REDUCED,
                   "Nur Wasserhaltung und Aufräumarbeiten.",
                   "Starkregen, Baugrube Achse A teilweise geflutet, Arbeiten ab 10 Uhr eingestellt."),
    "2026-11-11": ({"condition": "bewölkt", "temp_c": 6, "rain_mm": 1}, CREW_NORMAL,
                   "Baugrube leer gepumpt, Sauberkeitsschicht geprüft, keine Schäden.", ""),
    "2026-11-12": ({"condition": "sonnig", "temp_c": 7, "rain_mm": 0}, CREW_NORMAL,
                   "Bewehrungsabnahme Achse A durch Statiker ohne Beanstandung. Festlegung: Betonage Fundamente am 13.11.",
                   "Betonlieferung Transportbeton Huber 3 Stunden verspätet, Kolonne Rohbau 3 h Wartezeit."),
    "2026-11-13": ({"condition": "bewölkt", "temp_c": 8, "rain_mm": 0}, CREW_NORMAL,
                   "Fundamente Achse A betoniert (38 m³ C25/30).", ""),
    "2026-11-16": ({"condition": "bewölkt", "temp_c": 7, "rain_mm": 0}, CREW_NORMAL,
                   "Aushub Baugrube Achse B begonnen.", ""),
    "2026-11-17": ({"condition": "bewölkt", "temp_c": 6, "rain_mm": 0}, CREW_REDUCED,
                   "Aushub Achse B bis 10 Uhr, danach Umsetzen auf Nebenarbeiten.",
                   "Bagger steht seit 10 Uhr an Achse B: Leitungspläne vom Bauherrn fehlen, Lage der Gasleitung unklar. Bauherr telefonisch informiert."),
    "2026-11-18": ({"condition": "sonnig", "temp_c": 5, "rain_mm": 0}, CREW_REDUCED,
                   "Nebenarbeiten Achse A (Abdichtung Fundamente).",
                   "Weiterhin Stillstand Aushub Achse B wegen fehlender Leitungspläne. Bauherr sagt Pläne bis 19.11. zu."),
    "2026-11-19": ({"condition": "bewölkt", "temp_c": 4, "rain_mm": 0}, CREW_REDUCED,
                   "Nebenarbeiten, Vorbereitung Schalung Achse A Wände.",
                   "Leitungspläne bis Tagesende nicht eingegangen, dritter Tag Stillstand Aushub Achse B."),
    "2026-11-20": ({"condition": "sonnig", "temp_c": 6, "rain_mm": 0}, CREW_NORMAL,
                   "Leitungspläne 9 Uhr eingegangen, Aushub Achse B wieder aufgenommen. Festlegung mit Bauherr: Suchschachtung an der Gasleitung vor Weiterbaggern.",
                   ""),
}

PLAN_TITLE = "Bauzeitenplan Rohbau"
# (Code, Titel, Gewerk, Soll-Start, Soll-Ende)
TASKS = [
    ("A-100", "Baustelleneinrichtung", "Rohbau", "2026-11-02", "2026-11-02"),
    ("A-110", "Aushub Achse A", "Erdbau", "2026-11-02", "2026-11-04"),
    ("A-120", "Fundamente Achse A", "Rohbau", "2026-11-05", "2026-11-12"),
    ("B-200", "Aushub Achse B", "Erdbau", "2026-11-16", "2026-11-19"),
    ("A-130", "Wände Achse A", "Rohbau", "2026-11-23", "2026-11-30"),
    ("B-210", "Fundamente Achse B", "Rohbau", "2026-11-23", "2026-11-27"),
]
# Datum → {Vorgangscode: Fertigstellung in %}
PROGRESS = {
    "2026-11-02": {"A-100": 100, "A-110": 30}, "2026-11-03": {"A-110": 65}, "2026-11-04": {"A-110": 100},
    "2026-11-05": {"A-120": 15}, "2026-11-06": {"A-120": 30}, "2026-11-09": {"A-120": 50},
    "2026-11-10": {"A-120": 50}, "2026-11-11": {"A-120": 55}, "2026-11-12": {"A-120": 70},
    "2026-11-13": {"A-120": 100}, "2026-11-16": {"B-200": 25}, "2026-11-17": {"B-200": 30},
    "2026-11-18": {"B-200": 30}, "2026-11-19": {"B-200": 30, "A-130": 5}, "2026-11-20": {"B-200": 55},
}
DELIVERIES = {
    "2026-11-06": "Betonstahl B500B (12 t) angeliefert.",
    "2026-11-12": "Bewehrungsabnahme Achse A durch Statiker ohne Beanstandung.",
    "2026-11-13": "Transportbeton C25/30, 38 m³ (Fa. Huber).",
}


def seed_plan(session: Session, project: Project) -> dict[str, PlanTask]:
    """Plan + Vorgänge anlegen (oder vorhandene wiederverwenden). Rückgabe: Code → Vorgang."""
    plan = session.exec(select(ConstructionPlan).where(
        ConstructionPlan.project_id == project.id, ConstructionPlan.title == PLAN_TITLE)).first()
    if plan is None:
        plan = ConstructionPlan(project_id=project.id, title=PLAN_TITLE, version="1.0")
        session.add(plan)
        session.flush()
    existing = {t.task_code: t for t in session.exec(select(PlanTask).where(PlanTask.plan_id == plan.id)).all()}
    for code, title, trade, start, end in TASKS:
        if code not in existing:
            existing[code] = PlanTask(plan_id=plan.id, task_code=code, title=title, trade=trade,
                                      planned_start=dt.date.fromisoformat(start),
                                      planned_end=dt.date.fromisoformat(end), status="pending")
            session.add(existing[code])
    session.flush()
    return existing


def seed_all(session: Session, project: Project) -> tuple[dict[str, PlanTask], int]:
    """Plan, Berichte und Fortschritt für ein Projekt anlegen/ergänzen (ohne Commit). Auch von Tests genutzt."""
    tasks = seed_plan(session, project)
    existing = {r.report_date: r for r in session.exec(
        select(DailyReport).where(DailyReport.project_id == project.id)).all()}
    created = 0
    for number, (day, (weather, crew, done, incidents)) in enumerate(DAYS.items(), start=120):
        date = dt.date.fromisoformat(day)
        report = existing.get(date)
        if report is None:
            report = DailyReport(
                project_id=project.id, report_date=date,
                summary=done.split(".")[0] + ".",
                weather=json.dumps(weather, ensure_ascii=False),
                workforce=json.dumps(crew, ensure_ascii=False),
                equipment=json.dumps(EQUIP if crew is CREW_NORMAL else EQUIP[:1], ensure_ascii=False),
                work_completed=done, deviations_incidents=incidents or None, status="finalized",
            )
            created += 1
        # Neue Spalten auch bei älteren Seed-Berichten nachtragen (nur wenn leer).
        report.report_number = report.report_number or number
        report.workforce_count = report.workforce_count or sum(c["workers"] for c in crew)
        report.trades = report.trades or json.dumps([c["trade"] for c in crew], ensure_ascii=False)
        report.deliveries = report.deliveries or DELIVERIES.get(day)
        session.add(report)
        session.flush()
        for code, percent in PROGRESS.get(day, {}).items():
            known = session.exec(select(ReportProgress).where(
                ReportProgress.report_id == report.id, ReportProgress.task_id == tasks[code].id)).first()
            if known is None:
                session.add(ReportProgress(report_id=report.id, task_id=tasks[code].id,
                                           percent=percent, source="nutzer"))
    return tasks, created


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--project-id", type=int, default=None, help="Projekt-ID (Default: erstes Projekt)")
    args = parser.parse_args()

    init_db()
    with Session(engine) as session:
        project = (session.get(Project, args.project_id) if args.project_id
                   else session.exec(select(Project).order_by(Project.id)).first())
        if project is None:
            sys.exit("Kein Projekt gefunden – zuerst ein Projekt anlegen (POST /projects).")

        tasks, created = seed_all(session, project)
        session.commit()
        print(f"Projekt #{project.id} ({project.name}): Plan '{PLAN_TITLE}' mit {len(tasks)} Vorgängen, "
              f"{created} Tagesberichte neu, {len(DAYS) - created} vorhanden (ergänzt).")


if __name__ == "__main__":
    main()

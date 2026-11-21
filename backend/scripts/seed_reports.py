"""Legt Demo-Tagesberichte (Werktage 02.11.–20.11.2026) für ein Projekt an – Daten für /api/summarize.

Aufruf:  cd backend && DATABASE_URL=sqlite:///pfad/zur/kopie.db uv run python scripts/seed_reports.py [--project-id 1]

ACHTUNG: Ohne DATABASE_URL schreibt das Skript in die getrackte `data/site_assistant.db`.
Diese Änderung NICHT committen (Datenbank gehört Yannick, Seed/Reset ist sein Bereich).

Idempotent: Tage, für die es schon einen Bericht gibt, werden übersprungen.
Die Story: normaler Rohbau-Fortschritt, Regentag am 10.11., verspätete Betonlieferung am 12.11.,
Behinderung durch fehlende Leitungspläne vom 17.–19.11., Freigabe der Pläne am 20.11.
"""

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # damit `src` importierbar ist

from sqlmodel import Session, select  # noqa: E402

from src.database import engine, init_db  # noqa: E402
from src.models import DailyReport, Project  # noqa: E402

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

        existing = set(session.exec(select(DailyReport.report_date)
                                    .where(DailyReport.project_id == project.id)).all())
        created = 0
        for day, (weather, crew, done, incidents) in DAYS.items():
            date = dt.date.fromisoformat(day)
            if date in existing:
                continue
            session.add(DailyReport(
                project_id=project.id, report_date=date,
                summary=done.split(".")[0] + ".",
                weather=json.dumps(weather, ensure_ascii=False),
                workforce=json.dumps(crew, ensure_ascii=False),
                equipment=json.dumps(EQUIP if crew is CREW_NORMAL else EQUIP[:1], ensure_ascii=False),
                work_completed=done, deviations_incidents=incidents or None, status="finalized",
            ))
            created += 1
        session.commit()
        print(f"Projekt #{project.id} ({project.name}): {created} Tagesberichte angelegt, "
              f"{len(DAYS) - created} übersprungen.")


if __name__ == "__main__":
    main()

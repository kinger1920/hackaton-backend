"""Demo-Reset für die Jury (Contract: POST /api/demo/reset → {ok}).

Ablauf: komplette Datenbank leeren → festen Demo-Stand laden (Projekt mit Stammdaten, Firmen +
Verträge mit Sollstärke, Bauzeitenplan inkl. Zonen/Bereichen, 15 Tagesberichte, Fortschritt,
zwei Diktate, manuelle Termine aller Kategorien, Baustellenfotos mit Grafiken, Mängelrüge mit
Versandnachweis sowie Protokolle/E-Mails).
Die Story liegt im Seed auf 02.–20.11.2026; beim Reset wird sie um ganze WERKTAGE verschoben,
sodass der letzte Bericht auf dem letzten Werktag vor dem Stichtag liegt (Wochentage und
Vorgangsdauern bleiben stimmig, Datumsangaben im Text wandern mit).
"""

import datetime as dt
import importlib.util
import json
from pathlib import Path

from sqlmodel import Session, SQLModel, select

from src.database import UPLOADS_DIR
from src.models import (
    Appointment,
    Contract,
    DailyReport,
    FormalNotice,
    NoticeDraftData,
    PlanTask,
    Project,
    ProjectDocument,
    SiteNote,
    SitePhoto,
    UserProfile,
)
from src.routers.documents import DEFAULT_MINUTES_AND_EMAILS

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

TASK_LOCATIONS = {
    "A-100": "Baustelleneinrichtung Nord",
    "A-110": "Achse A (Haus B)",
    "A-120": "Achse A (Haus B)",
    "A-130": "Achse A (Haus B)",
    "B-200": "Achse B (Haus C)",
    "B-210": "Achse B (Haus C)",
}

DEMO_APPOINTMENTS = [
    dict(
        day="2026-11-12", time="14:00", category="inspection", trade="Rohbau",
        title="Bewehrungsabnahme Fundamente Achse A (Prüfstatiker Dr. Lang)",
        description="Abnahme der Fundamentbewehrung vor Betonage ohne Beanstandung.",
        vob_reference="§ 12 VOB/B", is_urgent=False,
    ),
    dict(
        day="2026-11-19", time="10:00", category="meeting", trade="Rohbau / Erdbau / TGA",
        title="Jour Fixe Nr. 18 — Rohbau & TGA Koordination",
        description="Klärung Leitungspläne Achse B, Sollstärke Fa. Krause und Aussparungen Schacht 3.",
        vob_reference=None, is_urgent=False,
    ),
    dict(
        day="2026-11-21", time="09:30", category="inspection", trade="Rohbau",
        title="Vorab-Kontrolle Schalung & Abdichtung Sockel Achse A",
        description="Begehung mit Polier vor Stellung der Wandschalung nächste Woche.",
        vob_reference="§ 4 Abs. 7 VOB/B", is_urgent=False,
    ),
    dict(
        day="2026-11-23", time="08:00", category="delivery", trade="Rohbau",
        title="Anlieferung Wandschalung & 24 t Betonstahl B500B",
        description="Kranfenster Kran 1 von 08:00 bis 10:30 Uhr freihalten, Zufahrt Tor Nord.",
        vob_reference=None, is_urgent=False,
    ),
    dict(
        day="2026-11-23", time="10:00", category="meeting", trade="Rohbau / TGA",
        title="Baubesprechung Rohbau & Leitungsfreigabe Achse B",
        description="Kontrolle Suchschachtung Gasleitung und Freigabe Rest-Aushub Achse B.",
        vob_reference="§ 6 Abs. 1 VOB/B", is_urgent=True,
    ),
    dict(
        day="2026-11-24", time="12:00", category="deadline", trade="TGA / Auftraggeber",
        title="Frist: Freigabe Schlitz- und Durchbruchspläne Schacht 3",
        description="Verbindliche Planlieferfrist laut Jour Fixe Nr. 18 zur Vermeidung von Schalungsstillstand.",
        vob_reference="§ 6 Abs. 1 VOB/B", is_urgent=True,
    ),
    dict(
        day="2026-11-25", time="14:00", category="inspection", trade="Rohbau",
        title="Abnahme Bewehrung Wände & Decke 1. OG (Prüfstatiker Dr. Lang)",
        description="Abnahme vor Betonage Bauteil B.",
        vob_reference="§ 12 VOB/B", is_urgent=True,
    ),
    dict(
        day="2026-11-27", time="16:00", category="deadline", trade="Rohbau",
        title="Nachfrist Mängelbeseitigung Fugenabdichtung Sockel Achse A",
        description="Kontrolle der Nachbesserung an der Fugenband-Einbindung (Mängelrüge #1).",
        vob_reference="§ 4 Abs. 7 VOB/B", is_urgent=True,
    ),
]

DEMO_PHOTOS = [
    dict(
        day="2026-11-10",
        file_name="starkregen_baugrube_achse_a.svg",
        bg="#1e3a8a",
        accent="#38bdf8",
        badge="WITTERUNG / STILLSTAND",
        headline="Baugrube Achse A — Starkregen",
        subline="22 mm Niederschlag • Wasserhaltung mit 2 Tauchpumpen aktiv",
        caption="Überflutete Baugrubensohle Achse A nach Starkregen",
        diary_text="Fotodokumentation: Baugrubensohle Achse A nach Starkregen (22 mm) teilweise unter Wasser; Erdarbeiten ab 10:00 Uhr eingestellt.",
        issues=["Baugrubensohle überflutet – Arbeiten ab 10:00 Uhr unterbrochen"],
    ),
    dict(
        day="2026-11-12",
        file_name="bewehrung_fundamente_achse_a.svg",
        bg="#064e3b",
        accent="#34d399",
        badge="ABNAHME OK",
        headline="Fundamentbewehrung Achse A",
        subline="B500B zweilagig verlegt • Betondeckung 50 mm geprüft",
        caption="Abgenommene Fundamentbewehrung Achse A vor Betonage",
        diary_text="Fotodokumentation: Bewehrung der Fundamente Achse A durch Prüfstatiker Dr. Lang ohne Beanstandung abgenommen.",
        issues=[],
    ),
    dict(
        day="2026-11-17",
        file_name="stillstand_bagger_gasleitung_achse_b.svg",
        bg="#7f1d1d",
        accent="#f87171",
        badge="BEHINDERUNG § 6 VOB/B",
        headline="Stillstand CAT 320 — Achse B",
        subline="Verdacht auf unkartierte Gasleitung • Bestandspläne fehlen",
        caption="Baggerstillstand Achse B wegen fehlender Leitungspläne",
        diary_text="Fotodokumentation: Kettenbagger CAT 320 steht seit 10:00 Uhr an Achse B still; Weiterarbeit ohne Leitungspläne des Bauherrn wegen Gasleitung nicht möglich.",
        issues=["Stillstand Bagger CAT 320 seit 10:00 Uhr", "Bestandspläne Gasleitung vom Auftraggeber fehlen"],
    ),
    dict(
        day="2026-11-19",
        file_name="mangel_fugenband_sockel_achse_a.svg",
        bg="#7c2d12",
        accent="#fb923c",
        badge="MANGEL § 4 Abs. 7 VOB/B",
        headline="Mangel Fugenband — Sockel Achse A",
        subline="Fehlende Einbindung & Kiesnest am Arbeitsfugenband",
        caption="Mangelhafte Fugenband-Einbindung und Kiesnest am Sockel Achse A",
        diary_text="Fotodokumentation: Am Fundament-/Wandanschluss Achse A (Feld 3) sitzt das Arbeitsfugenband nicht mittig, zudem lokales Kiesnest (ca. 35 cm) festgestellt.",
        issues=["Arbeitsfugenband verschoben & Kiesnest am Sockelanschluss Achse A"],
    ),
    dict(
        day="2026-11-20",
        file_name="suchschachtung_freigabe_achse_b.svg",
        bg="#0f172a",
        accent="#38bdf8",
        badge="SUCHSCHACHTUNG",
        headline="Handschachtung Gasleitung Achse B",
        subline="Leitung in 1,45 m Tiefe freigelegt & gesichert • Aushub läuft wieder",
        caption="Freigelegte und gesicherte Gasleitung nach Suchschachtung Achse B",
        diary_text="Fotodokumentation: Nach Eingang der Leitungspläne um 09:00 Uhr Suchschachtung an Achse B durchgeführt, Gasleitung gesichert und Aushub wieder aufgenommen.",
        issues=[],
    ),
    dict(
        day="2026-11-21",
        file_name="schalung_vorbereitung_achse_a.svg",
        bg="#1e293b",
        accent="#60a5fa",
        badge="BAUSTELLENKONTROLLE",
        headline="Vorbereitung Wandschalung Achse A",
        subline="Stellflächen geräumt • Anschlussbewehrung gerichtet",
        caption="Vorbereitete Stellfläche und Anschlussbewehrung für Wände Achse A",
        diary_text="Fotodokumentation: Anschlussbewehrung und Aufstellfläche für Wandschalung Achse A vorbereitet.",
        issues=[],
    ),
]


def _render_demo_svg(headline: str, subline: str, badge: str, date_str: str, bg: str, accent: str) -> bytes:
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{bg}"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="800" height="500" fill="url(#bg)"/>
  <rect width="800" height="500" fill="url(#grid)"/>
  <rect x="36" y="36" width="728" height="428" rx="16" fill="none" stroke="{accent}" stroke-width="2" stroke-dasharray="10 6" opacity="0.55"/>
  <!-- Schematische Baustellen-Illustration -->
  <g stroke="{accent}" stroke-width="3" fill="none" opacity="0.35">
    <path d="M 90 360 L 710 360"/>
    <rect x="130" y="220" width="180" height="140" rx="6"/>
    <line x1="130" y1="265" x2="310" y2="265"/>
    <line x1="130" y1="310" x2="310" y2="310"/>
    <line x1="190" y1="220" x2="190" y2="360"/>
    <line x1="250" y1="220" x2="250" y2="360"/>
    <path d="M 460 360 L 500 130 L 670 130"/>
    <line x1="500" y1="130" x2="430" y2="165"/>
    <line x1="635" y1="130" x2="635" y2="255"/>
    <rect x="610" y="255" width="50" height="35" rx="4"/>
  </g>
  <rect x="60" y="62" width="260" height="34" rx="17" fill="{accent}"/>
  <text x="190" y="84" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="800" fill="#0f172a" text-anchor="middle">{badge}</text>
  <text x="740" y="84" font-family="monospace" font-size="15" font-weight="700" fill="#e2e8f0" text-anchor="end">PRJ-2026-084 • {date_str}</text>
  <text x="60" y="395" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="800" fill="#ffffff">{headline}</text>
  <text x="60" y="430" font-family="system-ui, -apple-system, sans-serif" font-size="17" font-weight="500" fill="#cbd5e1">{subline}</text>
</svg>"""
    return svg.encode("utf-8")


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
    tasks, _ = seed.seed_all(session, project, shift)

    # Zonen/Bereiche direkt an den Vorgängen speichern (für ProgressMap / Baufortschritt)
    for code, task in tasks.items():
        if code in TASK_LOCATIONS:
            task.location = TASK_LOCATIONS[code]
            session.add(task)

    # Diktate / Notizen
    for day, time, category, text in DEMO_NOTES:
        d = shift(dt.date.fromisoformat(day))
        hh, mm = map(int, time.split(":"))
        session.add(SiteNote(project_id=project.id, content=text, category=category, status="incorporated",
                             created_at=dt.datetime(d.year, d.month, d.day, hh, mm, tzinfo=dt.timezone.utc)))

    # Manuelle Termine im Kalender
    for item in DEMO_APPOINTMENTS:
        d = shift(dt.date.fromisoformat(item["day"]))
        session.add(Appointment(
            project_id=project.id,
            title=item["title"],
            date=d,
            time=item["time"],
            category=item["category"],
            trade=item["trade"],
            description=item["description"],
            vob_reference=item["vob_reference"],
            is_urgent=item["is_urgent"],
        ))

    # Baustellenfotos anlegen (echte SVG-Grafiken in data/uploads/photos/)
    photos_dir = UPLOADS_DIR / "photos"
    photos_dir.mkdir(parents=True, exist_ok=True)
    for item in DEMO_PHOTOS:
        d = shift(dt.date.fromisoformat(item["day"]))
        dest = photos_dir / f"demo_{item['file_name']}"
        dest.write_bytes(
            _render_demo_svg(
                headline=item["headline"],
                subline=item["subline"],
                badge=item["badge"],
                date_str=d.strftime("%d.%m.%Y"),
                bg=item["bg"],
                accent=item["accent"],
            )
        )
        session.add(SitePhoto(
            project_id=project.id,
            report_date=d,
            file_name=item["file_name"],
            file_path=str(dest),
            mime_type="image/svg+xml",
            caption=item["caption"],
            diary_text=item["diary_text"],
            issues_json=json.dumps(item["issues"], ensure_ascii=False),
            source_mode="offline",
            created_at=dt.datetime(d.year, d.month, d.day, 15, 0, tzinfo=dt.timezone.utc),
        ))

    # Freigegebene Mängelrüge inkl. Versand- & Zugangsnachweis (stört den Sollstärke-Delay-Alert am 18.11. nicht!)
    defect_day = shift(dt.date(2026, 11, 19))
    defect_deadline = shift(dt.date(2026, 11, 27))
    defect_ts = dt.datetime(defect_day.year, defect_day.month, defect_day.day, 16, 15, tzinfo=dt.timezone.utc)
    defect_notice = FormalNotice(
        project_id=project.id,
        type="defect",
        title="Mängelanzeige: Fugenband & Kiesnest Sockel Achse A",
        recipient="BetonTech Rohbau GmbH",
        subject="Mängelanzeige gemäß § 4 Abs. 7 VOB/B – Fugenband-Einbindung Sockel Achse A",
        body=(
            f'Sehr geehrte Damen und Herren,\n\n'
            f'bei der Begehung der Baustelle im Bauvorhaben "{project.name}" ({project.number}) am '
            f'{defect_day:%d.%m.%Y} haben wir an Ihren Leistungen folgenden Mangel festgestellt:\n\n'
            f'1. Festgestellter Mangel\n'
            f'Ort: Achse A (Haus B), Sockelanschluss Feld 3\n'
            f'Beschreibung: Arbeitsfugenband nicht mittig eingebunden sowie lokales Kiesnest (ca. 35 cm).\n'
            f'Ausführende Firma: BetonTech Rohbau GmbH (Gewerk Rohbau)\n\n'
            f'2. Aufforderung zur Mängelbeseitigung\n'
            f'Wir fordern Sie gemäß § 4 Abs. 7 VOB/B auf, den Mangel fachgerecht bis zum '
            f'{defect_deadline:%d.%m.%Y} zu beseitigen.\n\n'
            f'Mit freundlichen Grüßen\n\nMax Mustermann\nBauleiter · Baupartner AG & Co. KG'
        ),
        status="Freigegeben",
        created_at=defect_ts,
        updated_at=defect_ts,
    )
    session.add(defect_notice)
    session.flush()
    session.add(NoticeDraftData(
        notice_id=defect_notice.id,
        fields_json=json.dumps({
            "recipient": {"value": "BetonTech Rohbau GmbH", "src": "nutzer"},
            "facts": {"value": "Arbeitsfugenband nicht mittig eingebunden sowie lokales Kiesnest (ca. 35 cm).", "src": "diktat"},
            "cause": {"value": "Ausführung durch BetonTech Rohbau GmbH", "src": "regel"},
            "location": {"value": "Achse A (Haus B), Sockelanschluss Feld 3", "src": "diktat"},
            "affected_work": {"value": "Rohbau", "src": "regel"},
            "deadline": {"value": defect_deadline.isoformat(), "src": "nutzer"},
        }, ensure_ascii=False),
        approved_by="Max Mustermann",
        approved_at=defect_ts,
        dispatch_json=json.dumps({
            "method": "einschreiben",
            "sent_at": f"{defect_day.isoformat()}T16:45",
            "tracking_number": "RR-482910384-DE",
            "received_at": shift(dt.date(2026, 11, 20)).isoformat(),
        }, ensure_ascii=False),
    ))

    # Protokolle & E-Mails sowie Standard-Profil anlegen
    for doc_item in DEFAULT_MINUTES_AND_EMAILS:
        session.add(ProjectDocument(
            project_id=project.id,
            doc_key=f"{doc_item['doc_key']}-p{project.id}",
            doc_type=doc_item["doc_type"],
            title=doc_item["title"],
            doc_date=doc_item["doc_date"],
            author=doc_item["author"],
            content=doc_item["content"],
        ))
    session.add(UserProfile())
    session.commit()

    count = lambda model, col: len(session.exec(select(model).where(col == project.id)).all())  # noqa: E731
    return {
        "ok": True, "project_id": project.id, "reports": count(DailyReport, DailyReport.project_id),
        "contracts": count(Contract, Contract.project_id), "tasks": len(session.exec(select(PlanTask)).all()),
        "notes": count(SiteNote, SiteNote.project_id), "last_report_date": shift(SEED_LAST_DAY).isoformat(),
        "shifted_workdays": offset,
    }

"""Briefvorlagen für die vier VOB/B-Schreiben (Behinderung, Mehrkosten, Mangel, Bedenken).

Der juristische Wortlaut steht NUR hier, in normalem, testbarem Code – nie vom LLM.
Texte übernommen aus dem Frontend-Entwurf (`frontend/src/letter drafts/LetterDrafts.tsx`).
Die KI liefert nur die Fakten (Felder); diese Datei setzt sie in den festen Text ein.
Fehlende Pflichtangaben erscheinen sichtbar als "[fehlt: …]" und blockieren die Freigabe.
"""

import datetime as dt

from src.config import settings
from src.models import Project
from src.schemas.ai import NoticeType, SourcedField
from src.services.extraction import REQUIRED_FIELDS

TYPE_NAMES: dict[NoticeType, str] = {
    "delay": "Behinderungsanzeige",
    "cost": "Mehrkostenanmeldung",
    "defect": "Mängelrüge",
    "concern": "Bedenkenanmeldung",
}

# Deutsche Bezeichnung je Feld – für "[fehlt: …]"-Platzhalter und Zeilenbeschriftungen.
FIELD_LABELS: dict[str, str] = {
    "recipient": "Empfänger",
    "location": "Ort",
    "start_date": "Datum",
    "start_time": "Uhrzeit",
    "cause": "Ursache",
    "facts": "Sachverhalt",
    "affected_work": "Betroffene Leistungen",
    "consequences": "Auswirkungen",
    "cost_estimate": "Voraussichtliche Mehrkosten",
    "deadline": "Frist",
}

PLACEHOLDER_PREFIX = "[fehlt:"


def _date_de(value: str) -> str:
    """ISO-Datum (YYYY-MM-DD) → deutsches Format (TT.MM.JJJJ); andere Werte unverändert."""
    try:
        return dt.date.fromisoformat(value).strftime("%d.%m.%Y")
    except ValueError:
        return value


class _Fields:
    """Kleiner Helfer: liefert Feldwerte oder sichtbare Platzhalter für Pflichtfelder."""

    def __init__(self, notice_type: NoticeType, fields: dict[str, SourcedField]):
        self._values = {k: f.value.strip() for k, f in fields.items() if f.value.strip()}
        self._required = set(REQUIRED_FIELDS[notice_type])

    def get(self, name: str) -> str:
        """Wert des Felds. Fehlt ein Pflichtfeld → "[fehlt: Label]", fehlt ein optionales → ""."""
        value = self._values.get(name, "")
        if name in ("start_date", "deadline") and value:
            value = _date_de(value)
        if not value and name in self._required:
            return f"{PLACEHOLDER_PREFIX} {FIELD_LABELS.get(name, name)}]"
        return value

    def line(self, name: str) -> str:
        """Beschriftete Zeile ("Ort: Achse B") – bei leerem optionalem Feld gar keine Zeile."""
        value = self.get(name)
        return f"{FIELD_LABELS[name]}: {value}\n" if value else ""

    def when(self) -> str:
        """Datum + optional Uhrzeit, z. B. "21.11.2026, 10:00 Uhr"."""
        date = self.get("start_date")
        time = self.get("start_time")
        return f"{date}, {time} Uhr" if date and time else date


def _project_ref(project: Project) -> str:
    number = f" (Projekt-Nr. {project.number})" if project.number else ""
    return f'"{project.name}"{number}'


def _signature() -> str:
    return f"Mit freundlichen Grüßen\n\n{settings.demo_user_name}\n{settings.demo_company}"


def _short(text: str, limit: int = 60) -> str:
    text = text.strip().rstrip(".")
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def render(notice_type: NoticeType, fields: dict[str, SourcedField], project: Project) -> tuple[str, str]:
    """Erzeugt (Betreff, Brieftext) aus Brieftyp, Feldern und Projekt.

    Input:  Brieftyp, Felder (value+src), Projekt (Name/Nummer für den Bezug).
    Output: Betreff und vollständiger Brieftext. Fehlende Pflichtangaben stehen als
            "[fehlt: …]" im Text, damit der Bauleiter sie sieht und /approve sie blockiert.
    """
    f = _Fields(notice_type, fields)
    ref = _project_ref(project)

    if notice_type == "delay":
        topic = f.get("cause") or f.get("facts")
        subject = f"Behinderungsanzeige gemäß § 6 Abs. 1 VOB/B — {_short(topic)}"
        body = f"""Sehr geehrte Damen und Herren,

hiermit zeigen wir Ihnen gemäß § 6 Abs. 1 VOB/B an, dass die Ausführung unserer vertraglichen Leistungen im Bauvorhaben {ref} behindert wird.

1. Sachverhaltsdarstellung und Behinderungstatbestand:
{f.get("facts")}
{f.line("location")}Beginn der Behinderung: {f.when()}
{f.line("cause")}{f.line("affected_work")}{f.line("consequences")}
2. Bauzeitliche Auswirkungen:
Die ordnungsgemäße und kontinuierliche Fortführung der Arbeiten ist seit dem {f.get("start_date")} unterbrochen. Das eingesetzte Fachpersonal sowie die Baustelleneinrichtung können im betroffenen Bauabschnitt derzeit nicht vertragsgemäß eingesetzt werden.

3. Aufforderung zur Abhilfe & Fristsetzung:
Wir fordern Sie auf, die vorstehend geschilderten Behinderungsursachen unverzüglich zu beseitigen und die Baufreiheit wiederherzustellen.

4. Rechtsfolgen & Vorbehalt:
Wir weisen darauf hin, dass sich die Ausführungsfristen gemäß § 6 Abs. 2 Nr. 1 Buchst. a VOB/B um die Dauer der Behinderung zuzüglich eines Zuschlags für die Wiederaufnahme der Arbeiten verlängern.
Die Geltendmachung von Entschädigungs- und Mehrkostenansprüchen (u. a. Stillstandskosten, Bauzeitverlängerungskosten) gemäß § 6 Abs. 6 VOB/B sowie § 642 BGB behalten wir uns ausdrücklich vor.

{_signature()}"""

    elif notice_type == "cost":
        subject = "Mehrkostenanmeldung / Nachtragsankündigung gemäß § 2 Abs. 5 / § 2 Abs. 6 VOB/B"
        body = f"""Sehr geehrte Damen und Herren,

zum Bauvorhaben {ref} kündigen wir Ihnen hiermit gemäß § 2 Abs. 5 bzw. § 2 Abs. 6 VOB/B einen Vergütungsanspruch für geänderte bzw. zusätzliche Leistungen an.

1. Begründung und Ursache des Mehraufwands:
{f.get("facts")}
{f.line("location")}{f.line("cause")}{f.line("affected_work")}{f.line("cost_estimate")}
2. Vertragliche Einordnung:
Diese Leistungen sind im ursprünglichen Leistungsverzeichnis nicht enthalten bzw. weichen von den vertraglichen Leistungsgrundlagen ab. Die Ausführung erfordert zusätzlichen Personal-, Material- und Maschineneinsatz.

3. Nachtragsangebot:
Wir werden Ihnen unverzüglich eine detaillierte Urkalkulation und ein Nachtragsangebot mit den entsprechenden Einheitspreisen zur Prüfung und Freigabe vorlegen.
Wir bitten um kurzfristige schriftliche Beauftragung vor Weiterführung der betroffenen Teilleistungen.

{_signature()}"""

    elif notice_type == "defect":
        subject = "Mängelrüge gemäß § 4 Abs. 7 / § 13 VOB/B — Aufforderung zur Mängelbeseitigung"
        body = f"""Sehr geehrte Damen und Herren,

bei der laufenden baubegleitenden Qualitätsprüfung im Bauvorhaben {ref} wurden bei Ihren Leistungen folgende Mängel bzw. Abweichungen von den anerkannten Regeln der Technik festgestellt:

1. Festgestellte Mängel:
{f.get("facts")}
{f.line("location")}{f.line("affected_work")}
2. Mängelrüge & Fristsetzung:
Wir fordern Sie hiermit gemäß § 4 Abs. 7 VOB/B förmlich auf, die genannten Mängel auf Ihre Kosten fachgerecht zu beseitigen.
Als Frist für die vollständige und mangelfreie Fertigstellung setzen wir Ihnen den:
{f.get("deadline")}

3. Androhung der Ersatzvornahme:
Sollte die Mängelbeseitigung nicht innerhalb der gesetzten Frist erfolgen, werden wir Ihnen nach Fristablauf den Auftrag für diesen Leistungsteil entziehen und die Mängel auf Ihre Kosten durch ein Drittunternehmen im Wege der Ersatzvornahme beseitigen lassen.

{_signature()}"""

    else:  # concern
        subject = "Bedenkenanmeldung gemäß § 4 Abs. 3 VOB/B"
        body = f"""Sehr geehrte Damen und Herren,

im Rahmen unserer Prüf- und Hinweispflicht gemäß § 4 Abs. 3 VOB/B melden wir Ihnen für das Bauvorhaben {ref} hiermit formell folgende Bedenken an:

1. Bedenkengrund:
Nach fachtechnischer Prüfung unserer Bauleitung bestehen Bedenken hinsichtlich:
{f.get("facts")}
{f.line("location")}{f.line("cause")}
2. Begründung der Bedenken:
Bei unveränderter Ausführung nach den derzeitigen Vorgaben bzw. auf den vorgefundenen Vorleistungen besteht die konkrete Gefahr von Folgeschäden, Gewährleistungsrisiken und Mängeln an den nachfolgenden Gewerken.

3. Erbetene Entscheidung:
Wir bitten Sie um schnellstmögliche bauseitige Prüfung und schriftliche Weisung, wie verfahren werden soll. Bis zur Klarstellung können die betroffenen Arbeiten zur Schadensvermeidung nicht begonnen werden.

{_signature()}"""

    return subject, body


def title_for(notice_type: NoticeType, fields: dict[str, SourcedField]) -> str:
    """Kurztitel für Listen, z. B. "Behinderungsanzeige – Achse B"."""
    hint = fields.get("location", SourcedField()).value or fields.get("start_date", SourcedField()).value
    return f"{TYPE_NAMES[notice_type]} – {hint}" if hint else TYPE_NAMES[notice_type]

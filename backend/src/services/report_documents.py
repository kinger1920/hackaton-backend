"""Export eines Bautagesberichts als PDF (Jinja2 → WeasyPrint) und Word (python-docx).

Contract §3: GET /api/reports/{date}/pdf · /docx.
Inhalt: Kopf, Wetter, Personal/Gewerke, Leistung, Vorkommnisse, Lieferungen, Soll/Ist je Vorgang,
"Was lief gut/schlecht" (nur Regeln, ohne KI → schnell und reproduzierbar) und Unterschriftsfeld.
Nicht abgeschlossene Berichte (Status ≠ "finalized") tragen sichtbar "ENTWURF".
Alle Zahlen kommen aus services/analysis.py (Code), nicht vom LLM.
"""

import datetime as dt
import io
import re
from dataclasses import dataclass, field
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlmodel import Session

from src.config import settings
from src.models import DailyReport, Project
from src.services import analysis
from src.services.documents import PDF_UNAVAILABLE_HINT, PdfUnavailable, pdf_available
from src.services.reports import to_out

TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates" / "reports"
# autoescape: Diktattext kann "<" oder "&" enthalten – darf das HTML nicht zerstören.
_jinja = Environment(loader=FileSystemLoader(TEMPLATE_DIR), autoescape=select_autoescape(["html"]))

WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
STATUS_LABELS = {"ontrack": "im Plan", "warning": "leichter Verzug", "delayed": "Verzug"}


@dataclass
class ProgressRow:
    code: str
    title: str
    plan: int
    actual: int
    delay: str  # "1,8" (Arbeitstage)
    status: str


@dataclass
class ReportDoc:
    """Alle Werte, die PDF und Word gleichermaßen brauchen."""

    number: str
    date: str
    weekday: str
    project_name: str
    project_number: str
    project_location: str
    company: str
    site_manager: str
    weather: str
    workforce: str
    trades: str
    work_completed: str
    incidents: str
    deliveries: str
    is_draft: bool
    progress: list[ProgressRow] = field(default_factory=list)
    went_well: list[str] = field(default_factory=list)
    went_badly: list[str] = field(default_factory=list)
    footer: str = ""


async def build(session: Session, project: Project, report: DailyReport) -> ReportDoc:
    """DB-Bericht → Exportdaten (inkl. Soll/Ist und Tagesanalyse ohne KI)."""
    out = to_out(session, project.id, report.report_date, report)
    date = report.report_date

    # Soll/Ist: Vorgänge, die heute gemeldet wurden oder laut Plan heute laufen.
    reported = {p.task_id for p in out.progress}
    packages, states, tasks = analysis.evaluate_tasks(session, project, date)
    rows = []
    for task, pkg, state in zip(tasks, packages, states):
        active = bool(task.planned_start and task.planned_end and task.planned_start <= date <= task.planned_end)
        if task.id in reported or active:
            rows.append(ProgressRow(code=pkg.id, title=pkg.name, plan=state.plan, actual=state.actual,
                                    delay=f"{state.delay:.1f}".replace(".", ","), status=STATUS_LABELS[pkg.status]))

    day = await analysis.analyze_day(session, project, date, use_llm=False)
    is_draft = report.status != "finalized"
    number = str(report.report_number) if report.report_number else "–"
    created = dt.datetime.now(dt.timezone.utc)
    return ReportDoc(
        number=number, date=date.strftime("%d.%m.%Y"), weekday=WEEKDAYS[date.weekday()],
        project_name=project.name, project_number=project.number or "", project_location=project.location or "",
        company=settings.demo_company, site_manager=settings.demo_user_name,
        weather=out.weather or "–",
        workforce=f"{out.workforce_count} Personen" if out.workforce_count is not None else "–",
        trades=", ".join(out.trades) or "–",
        work_completed=out.work_completed or "–", incidents=out.deviations_incidents or "keine",
        deliveries=out.deliveries or "–", is_draft=is_draft, progress=rows,
        went_well=[i.text for i in day.wentWell], went_badly=[i.text for i in day.wentBadly],
        footer=(f"Bautagesbericht Nr. {number} vom {date:%d.%m.%Y} · "
                f"{'ENTWURF – nicht abgeschlossen' if is_draft else 'abgeschlossen'} · "
                f"erstellt {created:%d.%m.%Y %H:%M} UTC"),
    )


def report_filename(report: DailyReport, ext: str) -> str:
    """Dateiname wie "Bautagesbericht_131_2026-11-17.pdf" (nur sichere Zeichen)."""
    parts = ["Bautagesbericht"]
    if report.report_number:
        parts.append(str(report.report_number))
    parts.append(report.report_date.isoformat())
    return re.sub(r"[^A-Za-z0-9_.-]", "-", "_".join(parts)) + f".{ext}"


def render_html(doc: ReportDoc) -> str:
    """HTML für den PDF-Export (separat, damit Tests das Layout auch ohne Pango prüfen können)."""
    return _jinja.get_template("daily_report.html").render(d=doc)


def render_pdf(doc: ReportDoc) -> bytes:
    """Exportdaten → PDF-Bytes. Fehler: PdfUnavailable, wenn Pango fehlt (→ 503)."""
    if not pdf_available():
        raise PdfUnavailable(PDF_UNAVAILABLE_HINT)
    import weasyprint  # spät importieren: ohne Pango läuft der Rest der App trotzdem

    return weasyprint.HTML(string=render_html(doc)).write_pdf()


def _heading(document: Document, text: str) -> None:
    p = document.add_paragraph()
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(11)


def _draft_mark(paragraph) -> None:
    run = paragraph.add_run("ENTWURF – nicht abgeschlossen")
    run.bold = True
    run.font.color.rgb = RGBColor(0xC0, 0x1C, 0x1C)


def render_docx(doc: ReportDoc) -> bytes:
    """Exportdaten → Word-Datei (.docx). Rein Python, keine Systembibliotheken."""
    document = Document()
    normal = document.styles["Normal"]
    normal.font.name = "Arial"
    normal.font.size = Pt(10)

    if doc.is_draft:
        # Seitenkopf auf jeder Seite – Word hat kein einfaches Wasserzeichen in python-docx.
        _draft_mark(document.sections[0].header.paragraphs[0])

    title = document.add_paragraph()
    run = title.add_run(f"Bautagesbericht Nr. {doc.number}")
    run.bold = True
    run.font.size = Pt(16)
    if doc.is_draft:
        _draft_mark(document.add_paragraph())

    meta = document.add_table(rows=0, cols=2)
    meta.style = "Table Grid"
    project = doc.project_name + (f" ({doc.project_number})" if doc.project_number else "")
    for label, value in (("Datum", f"{doc.weekday}, {doc.date}"), ("Bauvorhaben", project),
                         ("Ort", doc.project_location or "–"), ("Firma / Bauleitung", f"{doc.company} · {doc.site_manager}"),
                         ("Wetter", doc.weather), ("Personal", doc.workforce), ("Gewerke", doc.trades)):
        cells = meta.add_row().cells
        cells[0].text, cells[1].text = label, value

    for heading, text in (("Ausgeführte Arbeiten", doc.work_completed),
                          ("Vorkommnisse / Behinderungen", doc.incidents),
                          ("Lieferungen / Abnahmen / Prüfungen", doc.deliveries)):
        _heading(document, heading)
        document.add_paragraph(text)

    if doc.progress:
        _heading(document, "Soll/Ist je Vorgang (Bauzeitenplan)")
        table = document.add_table(rows=1, cols=6)
        table.style = "Table Grid"
        for cell, text in zip(table.rows[0].cells, ("Code", "Vorgang", "Soll %", "Ist %", "Verzug AT", "Status")):
            cell.text = text
        for r in doc.progress:
            cells = table.add_row().cells
            for cell, text in zip(cells, (r.code, r.title, str(r.plan), str(r.actual), r.delay, r.status)):
                cell.text = text

    _heading(document, "Tagesauswertung")
    for label, items in (("Was lief gut", doc.went_well), ("Was lief schlecht", doc.went_badly)):
        p = document.add_paragraph()
        p.add_run(f"{label}:").bold = True
        for item in items or ["–"]:
            document.add_paragraph(item, style="List Bullet")

    _heading(document, "Unterschriften")
    sign = document.add_table(rows=2, cols=2)
    sign.rows[0].cells[0].text = "\n\n______________________________"
    sign.rows[0].cells[1].text = "\n\n______________________________"
    sign.rows[1].cells[0].text = f"Ort, Datum / Bauleiter ({doc.site_manager})"
    sign.rows[1].cells[1].text = "Ort, Datum / Auftraggeber bzw. Bauüberwachung"

    footer = document.sections[0].footer.paragraphs[0]
    footer.text = doc.footer
    footer.alignment = WD_ALIGN_PARAGRAPH.LEFT
    footer.runs[0].font.size = Pt(7.5)

    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()

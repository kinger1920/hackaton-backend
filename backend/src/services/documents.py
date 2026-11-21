"""Export freigegebener Brief-Entwürfe als PDF (Jinja2 → WeasyPrint) und Word (python-docx).

Exportiert wird nur, was der Bauleiter freigegeben hat ("nichts ohne Freigabe").
Inhalt (Betreff, Brieftext) kommt unverändert aus dem FormalNotice – hier entsteht nur das Layout.
Jedes Dokument trägt den Hinweis "Keine Rechtsberatung" und das Freigabe-Audit (wer/wann).

macOS-Hinweis: WeasyPrint braucht Pango (`brew install pango`) und den Suchpfad
`DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib` (muss VOR dem Start von Python gesetzt sein –
`scripts/dev.sh` erledigt das). Ob PDF geht, zeigt `GET /health` → `pdf_export`.
"""

import datetime as dt
import functools
import io
import re
from dataclasses import dataclass
from pathlib import Path

from docx import Document
from docx.shared import Pt
from jinja2 import Environment, FileSystemLoader, select_autoescape

from src.config import settings
from src.models import FormalNotice, NoticeDraftData, Project
from src.services.letters import TYPE_NAMES

TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates" / "letters"

# autoescape: Text aus Diktaten kann "<" oder "&" enthalten – darf das HTML nicht zerstören.
_jinja = Environment(loader=FileSystemLoader(TEMPLATE_DIR), autoescape=select_autoescape(["html"]))


PDF_UNAVAILABLE_HINT = (
    "PDF-Export nicht verfügbar: WeasyPrint findet Pango nicht. Server mit `backend/scripts/dev.sh` "
    "starten (setzt den Pfad) bzw. einmalig `brew install pango`. Der Word-Export (.docx) funktioniert."
)


class PdfUnavailable(Exception):
    """WeasyPrint kann seine Systembibliotheken (Pango) nicht laden."""


@functools.cache
def pdf_available() -> bool:
    """True, wenn WeasyPrint samt Pango geladen werden kann (einmal geprüft, dann gecacht)."""
    try:
        import weasyprint  # noqa: F401
    except OSError:
        return False
    return True


@dataclass
class _LetterData:
    """Alle Werte, die PDF und Word gleichermaßen brauchen."""

    company: str
    user_name: str
    recipient: str
    date: str
    project_name: str
    project_number: str
    subject: str
    body: str
    disclaimer: str
    footer: str


def _letter_data(notice: FormalNotice, data: NoticeDraftData, project: Project) -> _LetterData:
    approved_at = data.approved_at or dt.datetime.now(dt.timezone.utc)
    # Audit im Dokument: zeigt, dass ein Mensch freigegeben hat (und wann).
    footer = (
        f"Freigegeben durch {data.approved_by or '–'} am {approved_at:%d.%m.%Y %H:%M} UTC · "
        f"Dokument-Nr. {notice.id}"
    )
    return _LetterData(
        company=settings.demo_company,
        user_name=settings.demo_user_name,
        recipient=notice.recipient or "",
        date=approved_at.strftime("%d.%m.%Y"),
        project_name=project.name if project else "",
        project_number=(project.number or "") if project else "",
        subject=notice.subject or "",
        body=notice.body,
        disclaimer=notice.legal_disclaimer,
        footer=footer,
    )


def filename(notice: FormalNotice, project: Project | None, ext: str) -> str:
    """Dateiname wie "Behinderungsanzeige_PRJ-2026-084_2026-11-21.pdf" (nur sichere Zeichen)."""
    parts = [TYPE_NAMES.get(notice.type, "Schreiben")]
    if project and project.number:
        parts.append(project.number)
    parts.append(dt.date.today().isoformat())
    name = "_".join(parts)
    name = name.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("Ä", "Ae").replace("ß", "ss")
    return re.sub(r"[^A-Za-z0-9_.-]", "-", name) + f".{ext}"


def render_pdf(notice: FormalNotice, data: NoticeDraftData, project: Project) -> bytes:
    """Freigegebener Brief → PDF-Bytes. Fehler: PdfUnavailable, wenn Pango fehlt."""
    if not pdf_available():
        raise PdfUnavailable(PDF_UNAVAILABLE_HINT)
    # Spät importieren: Fehlen die Systembibliotheken, läuft der Rest der App trotzdem.
    import weasyprint

    html = _jinja.get_template("notice.html").render(**vars(_letter_data(notice, data, project)))
    return weasyprint.HTML(string=html).write_pdf()


def render_docx(notice: FormalNotice, data: NoticeDraftData, project: Project) -> bytes:
    """Freigegebener Brief → Word-Datei (.docx) als Bytes. Rein Python, keine Systembibliotheken."""
    d = _letter_data(notice, data, project)
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Arial"
    style.font.size = Pt(10.5)

    sender = doc.add_paragraph(f"{d.company} · {d.user_name}")
    sender.runs[0].font.size = Pt(8)
    doc.add_paragraph(d.recipient)
    doc.add_paragraph(f"Datum: {d.date}")
    project_line = f"Bauvorhaben: {d.project_name}" + (f" ({d.project_number})" if d.project_number else "")
    doc.add_paragraph(project_line)

    subject = doc.add_paragraph()
    run = subject.add_run(d.subject)
    run.bold = True
    run.font.size = Pt(11)

    # Ein Absatz pro Leerzeilen-Block; einfache Zeilenumbrüche bleiben innerhalb des Absatzes.
    for block in d.body.split("\n\n"):
        doc.add_paragraph(block)

    for text in (d.disclaimer, d.footer):
        p = doc.add_paragraph(text)
        p.runs[0].font.size = Pt(8)

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()

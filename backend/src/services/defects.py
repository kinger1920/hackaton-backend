"""Mängelmanagement (Kern von /api/defects).

- Ort erkennen: ohne Haus/Ebene werden sie aus dem Freitext-Ort bzw. Titel erkannt – mit denselben Regeln
  wie die Gebäudeansicht im Baufortschritt (services/progress_map.py).
- Status-Datumsfelder pflegen: "behoben" setzt resolved_date, "abgenommen" zusätzlich accepted_date;
  zurück auf "offen"/"in_bearbeitung" löscht sie wieder.
- Überfällig = Frist vor dem Stichtag und weder behoben noch abgenommen.
- Mängelliste als Word (immer) und PDF (nur mit Pango) – Spalten wie ein klassisches Mängelprotokoll.
"""

import datetime as dt
import html
import io

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.shared import Cm, Pt
from sqlmodel import Session, select

from src.models import Defect, Project
from src.schemas.defects import DefectCompanyCount, DefectIn, DefectOut, DefectPatch, DefectSummary
from src.services import progress_map
from src.services.documents import PDF_UNAVAILABLE_HINT, PdfUnavailable, pdf_available
from src.services.reports import project_tasks

OPEN_STATUSES = ("offen", "in_bearbeitung")
STATUS_LABELS = {"offen": "offen", "in_bearbeitung": "in Bearbeitung", "behoben": "behoben", "abgenommen": "abgenommen"}
PRIORITY_ORDER = {"hoch": 0, "mittel": 1, "niedrig": 2}


def _de(d: dt.date | None) -> str:
    return d.strftime("%d.%m.%Y") if d else "–"


def is_overdue(d: Defect, ref: dt.date) -> bool:
    return d.status in OPEN_STATUSES and d.deadline is not None and d.deadline < ref


def to_out(d: Defect, ref: dt.date) -> DefectOut:
    overdue = is_overdue(d, ref)
    return DefectOut(
        **d.model_dump(exclude={"id", "is_overdue", "days_overdue"}), id=d.id,
        is_overdue=overdue, days_overdue=(ref - d.deadline).days if overdue else 0,
    )


def place(session: Session, project_id: int, d: Defect) -> None:
    """Haus/Ebene aus Ort oder Titel ergänzen (nur wenn nicht gesetzt)."""
    if d.house and d.level:
        return
    axis_houses = progress_map._axis_houses(project_tasks(session, project_id))
    text = f"{d.location or ''} {d.title}"
    d.house = d.house or progress_map.parse_house(text, axis_houses)
    d.level = d.level or progress_map.parse_level(text)


def _apply_status(d: Defect, status: str, today: dt.date) -> None:
    if status == d.status:
        return
    d.status = status
    if status in OPEN_STATUSES:
        d.resolved_date = None
        d.accepted_date = None
    elif status == "behoben":
        d.resolved_date = d.resolved_date or today
        d.accepted_date = None
    elif status == "abgenommen":
        d.resolved_date = d.resolved_date or today
        d.accepted_date = d.accepted_date or today


def create(session: Session, data: DefectIn, today: dt.date) -> Defect:
    d = Defect(**data.model_dump(exclude={"status", "found_date"}), found_date=data.found_date or today)
    _apply_status(d, data.status, today)
    place(session, data.project_id, d)
    session.add(d)
    session.commit()
    session.refresh(d)
    return d


def patch(session: Session, d: Defect, data: DefectPatch, today: dt.date) -> Defect:
    changes = data.model_dump(exclude_unset=True)
    status = changes.pop("status", None)
    location_changed = "location" in changes and not ({"house", "level"} & changes.keys())
    for key, value in changes.items():
        setattr(d, key, value)
    if status:
        _apply_status(d, status, today)
    if location_changed:
        d.house, d.level = None, None
    place(session, d.project_id, d)
    d.updated_at = dt.datetime.now(dt.timezone.utc)
    session.add(d)
    session.commit()
    session.refresh(d)
    return d


def query(session: Session, project_id: int, status: str | None = None, company: str | None = None,
          house: str | None = None, overdue: bool | None = None, ref: dt.date | None = None) -> list[Defect]:
    """Gefiltert und sortiert: überfällige zuerst, dann Priorität, dann Frist, dann neueste."""
    ref = ref or dt.date.today()
    rows = session.exec(select(Defect).where(Defect.project_id == project_id)).all()
    if status == "open":
        rows = [d for d in rows if d.status in OPEN_STATUSES]
    elif status:
        rows = [d for d in rows if d.status == status]
    if company:
        rows = [d for d in rows if (d.company or "").lower() == company.lower()]
    if house:
        rows = [d for d in rows if d.house == house]
    if overdue is not None:
        rows = [d for d in rows if is_overdue(d, ref) == overdue]
    return sorted(rows, key=lambda d: (
        not is_overdue(d, ref), d.status not in OPEN_STATUSES, PRIORITY_ORDER.get(d.priority, 1),
        d.deadline or dt.date.max, -d.found_date.toordinal(), -(d.id or 0),
    ))


def summary(session: Session, project_id: int, ref: dt.date) -> DefectSummary:
    rows = session.exec(select(Defect).where(Defect.project_id == project_id)).all()
    by_status = {s: 0 for s in STATUS_LABELS}
    companies: dict[str, DefectCompanyCount] = {}
    for d in rows:
        by_status[d.status] = by_status.get(d.status, 0) + 1
        if d.status in OPEN_STATUSES:
            name = d.company or "ohne Firma"
            c = companies.setdefault(name, DefectCompanyCount(company=name, open=0, overdue=0))
            c.open += 1
            c.overdue += int(is_overdue(d, ref))
    return DefectSummary(
        total=len(rows), by_status=by_status, open=by_status["offen"] + by_status["in_bearbeitung"],
        overdue=sum(1 for d in rows if is_overdue(d, ref)),
        by_company=sorted(companies.values(), key=lambda c: (-c.overdue, -c.open, c.company)),
    )


# ---------------------------------------------------------------- Mängelliste (Word / PDF)

COLUMNS = ["Nr.", "Mangel", "Ort", "Firma", "Festgestellt", "Frist", "Status"]


def _row(d: Defect, ref: dt.date) -> list[str]:
    where = " · ".join(x for x in (d.house, d.level) if x) or "–"
    if d.location and d.location not in where:
        where = f"{where}\n{d.location}" if where != "–" else d.location
    status = STATUS_LABELS.get(d.status, d.status)
    if is_overdue(d, ref):
        status += f" – {(ref - d.deadline).days} T. überfällig"
    elif d.status == "abgenommen" and d.accepted_date:
        status += f" am {_de(d.accepted_date)}"
    elif d.status == "behoben" and d.resolved_date:
        status += f" am {_de(d.resolved_date)}"
    title = d.title + (f"\n{d.description}" if d.description else "")
    return [str(d.id), title, where, d.company or "–", _de(d.found_date), _de(d.deadline), status]


def _heading(project: Project, ref: dt.date, label: str) -> tuple[str, str]:
    return (f"Mängelliste – {project.name}",
            f"Projekt-Nr. {project.number or '–'} · Stand {_de(ref)} · {label}")


def render_docx(project: Project, defects: list[Defect], ref: dt.date, label: str) -> bytes:
    doc = Document()
    section = doc.sections[0]
    section.orientation = WD_ORIENT.LANDSCAPE
    section.page_width, section.page_height = section.page_height, section.page_width
    for side in ("left_margin", "right_margin", "top_margin", "bottom_margin"):
        setattr(section, side, Cm(1.6))
    title, sub = _heading(project, ref, label)
    doc.add_heading(title, level=1)
    doc.add_paragraph(sub)
    table = doc.add_table(rows=1, cols=len(COLUMNS))
    table.style = "Table Grid"
    for cell, name in zip(table.rows[0].cells, COLUMNS):
        cell.text = name
        cell.paragraphs[0].runs[0].bold = True
    for d in defects:
        for cell, value in zip(table.add_row().cells, _row(d, ref)):
            cell.text = value
    for row in table.rows:
        for cell in row.cells:
            for p in cell.paragraphs:
                for r in p.runs:
                    r.font.size = Pt(9)
    if not defects:
        doc.add_paragraph("Keine Mängel für diese Auswahl.")
    doc.add_paragraph()
    doc.add_paragraph("Aufgestellt: ______________________ (Bauleitung)        "
                      "Zur Kenntnis: ______________________ (Firma)")
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def render_pdf(project: Project, defects: list[Defect], ref: dt.date, label: str) -> bytes:
    if not pdf_available():
        raise PdfUnavailable(PDF_UNAVAILABLE_HINT)
    import weasyprint

    title, sub = _heading(project, ref, label)
    esc = lambda s: html.escape(s).replace("\n", "<br>")  # noqa: E731
    head = "".join(f"<th>{esc(c)}</th>" for c in COLUMNS)
    body = "".join(
        f"<tr class=\"{'overdue' if is_overdue(d, ref) else ''}\">" + "".join(f"<td>{esc(v)}</td>" for v in _row(d, ref)) + "</tr>"
        for d in defects
    ) or f"<tr><td colspan=\"{len(COLUMNS)}\">Keine Mängel für diese Auswahl.</td></tr>"
    page = f"""<html><head><meta charset="utf-8"><style>
@page {{ size: A4 landscape; margin: 14mm; }}
body {{ font-family: sans-serif; font-size: 9pt; color: #0f172a; }}
h1 {{ font-size: 15pt; margin: 0 0 2mm; }} p.sub {{ color: #475569; margin: 0 0 5mm; }}
table {{ width: 100%; border-collapse: collapse; }}
th, td {{ border: 0.5pt solid #94a3b8; padding: 2mm; vertical-align: top; text-align: left; }}
th {{ background: #e2e8f0; }} tr.overdue td {{ background: #fee2e2; }}
.sign {{ margin-top: 12mm; display: flex; justify-content: space-between; }}
</style></head><body><h1>{esc(title)}</h1><p class="sub">{esc(sub)}</p>
<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>
<p class="sign"><span>Aufgestellt: ______________________ (Bauleitung)</span>
<span>Zur Kenntnis: ______________________ (Firma)</span></p></body></html>"""
    return weasyprint.HTML(string=page).write_pdf()

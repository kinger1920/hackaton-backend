"""Tests für GET /api/reports/{date}/pdf|docx – auf den Demo-Seed-Daten, ohne Netz und ohne KI."""

import asyncio
import datetime as dt
import importlib.util
import io
from pathlib import Path

import pytest
from docx import Document
from sqlmodel import Session

from src.models import Project
from src.services import documents, llm, report_documents
from src.services.reports import find_report

_SEED = Path(__file__).resolve().parent.parent / "scripts" / "seed_reports.py"
_spec = importlib.util.spec_from_file_location("seed_reports", _SEED)
seed_reports = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seed_reports)

needs_pdf = pytest.mark.skipif(not documents.pdf_available(), reason="WeasyPrint/Pango nicht verfügbar")


@pytest.fixture
def seeded(engine, monkeypatch) -> int:
    async def no_llm(*a, **kw):
        raise AssertionError("Export darf die KI nicht aufrufen")

    monkeypatch.setattr(llm, "complete_json", no_llm)
    with Session(engine) as s:
        p = Project(name="Schulzentrum", number="PRJ-1", location="Berlin")
        s.add(p)
        s.commit()
        seed_reports.seed_all(s, p)
        s.commit()
        return p.id


def _docx_text(content: bytes) -> str:
    doc = Document(io.BytesIO(content))
    parts = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        parts += [cell.text for row in table.rows for cell in row.cells]
    parts += [p.text for p in doc.sections[0].header.paragraphs]
    return "\n".join(parts)


def test_docx_export_finalized_report(client, seeded):
    r = client.get(f"/api/reports/2026-11-17/docx?project_id={seeded}")
    assert r.status_code == 200
    assert r.headers["content-disposition"] == 'attachment; filename="Bautagesbericht_131_2026-11-17.docx"'
    text = _docx_text(r.content)
    assert "Bautagesbericht Nr. 131" in text
    assert "Dienstag, 17.11.2026" in text
    assert "Bagger steht seit 10 Uhr" in text
    assert "Aushub Achse B" in text and "Was lief schlecht" in text
    assert "Personal unter Soll" in text
    assert "Auftraggeber bzw. Bauüberwachung" in text
    assert "ENTWURF" not in text  # Seed-Berichte sind abgeschlossen


def test_draft_is_marked(client, seeded):
    url = f"/api/reports/2026-11-17?project_id={seeded}"
    current = client.get(url).json()
    client.put(url, json={**current, "status": "draft", "progress": None})
    assert "ENTWURF – nicht abgeschlossen" in _docx_text(client.get(f"{url.replace('17?', '17/docx?')}").content)


def test_pdf_html_has_watermark_only_for_drafts(engine, seeded):
    with Session(engine) as s:
        project = s.get(Project, seeded)
        report = find_report(s, seeded, dt.date(2026, 11, 17))
        doc = asyncio.run(report_documents.build(s, project, report))
        assert 'class="watermark"' not in report_documents.render_html(doc)
        doc.is_draft = True
        html = report_documents.render_html(doc)
    assert 'class="watermark">ENTWURF' in html
    assert "Soll/Ist je Vorgang" in html and "B-200" in html


@needs_pdf
def test_pdf_export(client, seeded):
    r = client.get(f"/api/reports/2026-11-17/pdf?project_id={seeded}")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")


def test_pdf_without_pango_503(client, seeded, monkeypatch):
    monkeypatch.setattr(report_documents, "pdf_available", lambda: False)
    r = client.get(f"/api/reports/2026-11-17/pdf?project_id={seeded}")
    assert r.status_code == 503 and "dev.sh" in r.json()["detail"]


def test_missing_report_or_project_404(client, seeded):
    assert client.get(f"/api/reports/2026-11-22/pdf?project_id={seeded}").status_code == 404
    assert client.get(f"/api/reports/2026-11-22/docx?project_id={seeded}").status_code == 404
    assert client.get("/api/reports/2026-11-17/docx?project_id=999").status_code == 404

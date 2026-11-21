"""Tests für den Export freigegebener Briefe als PDF und Word (GET /api/notices/{id}/pdf|docx).

PDF-Tests laufen nur, wenn WeasyPrint seine Systembibliotheken findet
(macOS: `brew install pango` + DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib), sonst übersprungen.
"""

import io

import pytest
from docx import Document
from sqlmodel import Session

from src.models import Project

try:
    import weasyprint  # noqa: F401

    HAS_PDF = True
except OSError:
    HAS_PDF = False

needs_pdf = pytest.mark.skipif(not HAS_PDF, reason="WeasyPrint/Pango nicht verfügbar")


def _approved_notice(client, engine) -> int:
    with Session(engine) as s:
        p = Project(name="Neubau Nord", number="PRJ-1", client="Stadt Berlin")
        s.add(p)
        s.commit()
        project_id = p.id
    r = client.post("/api/capture", json={"text": "Bagger steht seit 10 Uhr.", "project_id": project_id})
    notice_id = r.json()["notice_id"]
    client.patch(f"/api/notices/{notice_id}", json={"fields": {"location": "Achse B", "cause": "Pläne fehlen"}})
    assert client.post(f"/api/notices/{notice_id}/approve").status_code == 200
    return notice_id


def test_docx_export(client, engine):
    notice_id = _approved_notice(client, engine)
    r = client.get(f"/api/notices/{notice_id}/docx")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats")
    assert 'filename="Behinderungsanzeige_PRJ-1_' in r.headers["content-disposition"]

    text = "\n".join(p.text for p in Document(io.BytesIO(r.content)).paragraphs)
    assert "Behinderungsanzeige gemäß § 6 Abs. 1 VOB/B" in text
    assert "Stadt Berlin" in text
    assert "Ort: Achse B" in text
    assert "Keine Rechtsberatung" in text
    assert "Freigegeben durch Bauleiter" in text


@needs_pdf
def test_pdf_export(client, engine):
    notice_id = _approved_notice(client, engine)
    r = client.get(f"/api/notices/{notice_id}/pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF-")
    assert len(r.content) > 5_000  # echtes Dokument, kein leeres PDF


def test_export_sets_status_exported_and_allows_redownload(client, engine):
    notice_id = _approved_notice(client, engine)
    assert client.get(f"/api/notices/{notice_id}/docx").status_code == 200
    assert client.get(f"/api/notices/{notice_id}").json()["status"] == "Exportiert"
    assert client.get(f"/api/notices/{notice_id}/docx").status_code == 200  # erneuter Download erlaubt


@pytest.mark.parametrize("ext", ["pdf", "docx"])
def test_draft_cannot_be_exported(client, engine, ext):
    with Session(engine) as s:
        s.add(Project(name="X", client="Y"))
        s.commit()
    notice_id = client.post("/api/capture", json={"text": "Bagger steht."}).json()["notice_id"]
    r = client.get(f"/api/notices/{notice_id}/{ext}")
    assert r.status_code == 409
    assert client.get(f"/api/notices/{notice_id}").json()["status"] == "Entwurf"


@pytest.mark.parametrize("ext", ["pdf", "docx"])
def test_unknown_notice_export_404(client, ext):
    assert client.get(f"/api/notices/999/{ext}").status_code == 404

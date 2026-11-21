"""Service für Vertrags-PDFs: Speichern, Text-Extraktion und KI-Kontext-Aufbereitung."""

import io
import logging
import re
import uuid
from pathlib import Path

from pypdf import PdfReader
from sqlmodel import Session, select

from src.database import UPLOADS_DIR
from src.models import Contract

logger = logging.getLogger(__name__)

CONTRACTS_UPLOAD_DIR = UPLOADS_DIR / "contracts"
CONTRACTS_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _safe_filename(original_name: str) -> str:
    base = Path(original_name).name
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", base)
    return cleaned or "contract.pdf"


def save_contract_pdf(data: bytes, original_name: str) -> tuple[str, Path]:
    """Speichert die hochgeladene PDF-Datei unter `data/uploads/contracts/`."""
    CONTRACTS_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_filename(original_name)
    stored_name = f"{uuid.uuid4().hex}_{safe_name}"
    dest = CONTRACTS_UPLOAD_DIR / stored_name
    dest.write_bytes(data)
    return safe_name, dest


def extract_pdf_text(data: bytes) -> str:
    """Extrahiert den Text aller Seiten einer PDF-Datei für den KI-Abgleich."""
    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n\n".join(p.strip() for p in pages if p.strip()).strip()
    except Exception as exc:
        logger.warning("PDF-Text konnte nicht extrahiert werden: %s", exc)
        return ""


def delete_contract_file(file_path: str | None) -> None:
    """Löscht die gespeicherte PDF-Datei von der Platte, falls vorhanden."""
    if not file_path:
        return
    try:
        path = Path(file_path)
        if path.is_file():
            path.unlink()
    except OSError as exc:
        logger.warning("Vertragsdatei %s konnte nicht gelöscht werden: %s", file_path, exc)


def get_project_contracts_context(session: Session, project_id: int, max_chars_per_contract: int = 8000) -> str:
    """Bereitet alle Verträge eines Projekts als kompakten Textblock für LLM-Prompts auf.

    Kann in weiteren Schritten direkt an `services/extraction.py` oder `services/review.py`
    übergeben werden, um z. B. Sollstärke oder firmenspezifische VOB-Klauseln abzugleichen.
    """
    contracts = session.exec(
        select(Contract).where(Contract.project_id == project_id).order_by(Contract.id)
    ).all()
    if not contracts:
        return ""

    blocks: list[str] = []
    for c in contracts:
        header_parts = [f"Vertrag #{c.id}: {c.title}"]
        if c.contractor_name:
            header_parts.append(f"Firma: {c.contractor_name}")
        if c.trade:
            header_parts.append(f"Gewerk: {c.trade}")
        if c.planned_workforce is not None:
            header_parts.append(f"Sollstärke: {c.planned_workforce} Arbeiter")
        if c.vob_notes:
            header_parts.append(f"VOB/Besonderheiten: {c.vob_notes}")

        text = (c.extracted_text or "").strip()
        if len(text) > max_chars_per_contract:
            text = text[:max_chars_per_contract].rstrip() + "\n[... gekürzt]"

        block = " | ".join(header_parts)
        if text:
            block += f"\nInhalt:\n{text}"
        blocks.append(block)

    return "\n\n---\n\n".join(blocks)

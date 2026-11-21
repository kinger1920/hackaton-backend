"""Vertrag parsen (Board: "Vertrag parsen: Sollstärke extrahieren").

Eigener Router neben Yannicks `/contracts`-CRUD, damit dessen Datei unverändert bleibt.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from src.database import get_session
from src.models import Contract
from src.schemas.contract_parse import ContractParseResponse
from src.services.contract_parse import parse_contract

router = APIRouter(prefix="/api/contracts", tags=["Contracts"])


@router.post("/{contract_id}/parse", response_model=ContractParseResponse)
async def parse(contract_id: int, session: Session = Depends(get_session)) -> ContractParseResponse:
    """Liest Sollstärke, Firma, Gewerk, Ausführungsfrist und VOB-Besonderheiten aus dem Vertragstext.

    Output: Vorschlag je Feld mit Fundstelle + `suggested_patch` für PATCH /contracts/{id}. Speichert nichts.
    Antwortet auch ohne KI mit 200 (`mode: "offline"`, Regex-Regeln).
    Fehler: 404 Vertrag unbekannt · 422 kein Vertragstext (PDF ohne Textebene, z. B. Scan).
    """
    contract = session.get(Contract, contract_id)
    if contract is None:
        raise HTTPException(status_code=404, detail=f"Vertrag {contract_id} nicht gefunden")
    if not (contract.extracted_text or "").strip():
        # 422: Anfrage ok, aber ohne Text gibt es nichts zu lesen (gescanntes PDF braucht OCR).
        raise HTTPException(status_code=422, detail="Vertrag hat keinen auslesbaren Text (gescanntes PDF?)")
    return await parse_contract(contract)

from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlmodel import Session, select

from src.database import get_session
from src.models import Contract, ContractRead, ContractUpdate, Project
from src.services.contracts import delete_contract_file, extract_pdf_text, save_contract_pdf

router = APIRouter(prefix="/contracts", tags=["Contracts"])


def _get_or_404(session: Session, contract_id: int) -> Contract:
    contract = session.get(Contract, contract_id)
    if not contract:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contract not found",
        )
    return contract


@router.get("", response_model=list[ContractRead])
def list_contracts(
    project_id: int | None = None,
    is_active: bool | None = None,
    session: Session = Depends(get_session),
):
    statement = select(Contract)
    if project_id is not None:
        statement = statement.where(Contract.project_id == project_id)
    contracts = session.exec(statement).all()
    if is_active is not None:
        contracts = [c for c in contracts if (c.is_active is not False) is is_active]
    return contracts


@router.get("/{contract_id}", response_model=ContractRead)
def get_contract(
    contract_id: int,
    session: Session = Depends(get_session),
):
    return _get_or_404(session, contract_id)


@router.get("/{contract_id}/file")
def download_contract_file(
    contract_id: int,
    session: Session = Depends(get_session),
):
    contract = _get_or_404(session, contract_id)
    if not contract.file_path or not Path(contract.file_path).is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contract PDF file not found on disk",
        )
    return FileResponse(
        path=contract.file_path,
        media_type="application/pdf",
        filename=contract.file_name or f"contract_{contract.id}.pdf",
    )


@router.get("/{contract_id}/text")
def get_contract_text(
    contract_id: int,
    session: Session = Depends(get_session),
):
    """Gibt den extrahierten PDF-Text und Metadaten zurück (Grundlage für KI-Abgleich)."""
    contract = _get_or_404(session, contract_id)
    return {
        "id": contract.id,
        "project_id": contract.project_id,
        "title": contract.title,
        "contractor_name": contract.contractor_name,
        "trade": contract.trade,
        "planned_workforce": contract.planned_workforce,
        "vob_notes": contract.vob_notes,
        "extracted_text": contract.extracted_text or "",
    }


@router.post("", response_model=ContractRead, status_code=status.HTTP_201_CREATED)
async def upload_contract(
    project_id: int = Form(...),
    title: str = Form(...),
    contractor_name: str | None = Form(None),
    trade: str | None = Form(None),
    planned_workforce: int | None = Form(None),
    vob_notes: str | None = Form(None),
    is_active: bool = Form(True),
    file: UploadFile = File(..., description="Vertrags-PDF"),
    session: Session = Depends(get_session),
):
    if not session.get(Project, project_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    filename = file.filename or ""
    is_pdf = filename.lower().endswith(".pdf") or file.content_type == "application/pdf"
    if not is_pdf:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF files are supported",
        )

    data = await file.read()
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded PDF file is empty",
        )

    safe_name, dest_path = save_contract_pdf(data, filename)
    extracted_text = extract_pdf_text(data)

    db_contract = Contract(
        project_id=project_id,
        title=title,
        contractor_name=contractor_name,
        trade=trade,
        planned_workforce=planned_workforce,
        vob_notes=vob_notes,
        is_active=is_active,
        file_name=safe_name,
        file_path=str(dest_path),
        extracted_text=extracted_text,
    )
    session.add(db_contract)
    session.commit()
    session.refresh(db_contract)
    return db_contract


@router.put("/{contract_id}/file", response_model=ContractRead)
async def replace_contract_file(
    contract_id: int,
    file: UploadFile = File(..., description="Vertrags-PDF"),
    session: Session = Depends(get_session),
):
    """PDF an einen bestehenden Vertrag anhängen oder ersetzen (z. B. Demo-/Projektformular-Verträge ohne Datei).

    Der Volltext wird neu extrahiert, damit „Auslesen“ (POST /api/contracts/{id}/parse) danach funktioniert.
    """
    db_contract = _get_or_404(session, contract_id)
    filename = file.filename or ""
    if not (filename.lower().endswith(".pdf") or file.content_type == "application/pdf"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only PDF files are supported")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded PDF file is empty")

    old_path = db_contract.file_path
    safe_name, dest_path = save_contract_pdf(data, filename)
    db_contract.file_name = safe_name
    db_contract.file_path = str(dest_path)
    db_contract.extracted_text = extract_pdf_text(data)
    session.add(db_contract)
    session.commit()
    session.refresh(db_contract)
    if old_path and old_path != str(dest_path):
        delete_contract_file(old_path)
    return db_contract


@router.patch("/{contract_id}", response_model=ContractRead)
def update_contract(
    contract_id: int,
    contract_update: ContractUpdate,
    session: Session = Depends(get_session),
):
    db_contract = _get_or_404(session, contract_id)
    update_data = contract_update.model_dump(exclude_unset=True)
    db_contract.sqlmodel_update(update_data)
    session.add(db_contract)
    session.commit()
    session.refresh(db_contract)
    return db_contract


@router.delete("/{contract_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contract(
    contract_id: int,
    session: Session = Depends(get_session),
):
    db_contract = _get_or_404(session, contract_id)
    file_path = db_contract.file_path
    session.delete(db_contract)
    session.commit()
    delete_contract_file(file_path)

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from src.database import get_session
from src.models import Company, CompanyCreate, CompanyRead, CompanyUpdate

router = APIRouter(prefix="/companies", tags=["Companies"])


def _get_or_404(session: Session, company_id: int) -> Company:
    company = session.get(Company, company_id)
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found",
        )
    return company


@router.get("", response_model=list[CompanyRead])
def list_companies(
    company_type: str | None = None,
    trade: str | None = None,
    session: Session = Depends(get_session),
):
    statement = select(Company)
    if company_type is not None:
        statement = statement.where(Company.company_type == company_type)
    if trade is not None:
        statement = statement.where(Company.trade == trade)
    return session.exec(statement).all()


@router.get("/{company_id}", response_model=CompanyRead)
def get_company(
    company_id: int,
    session: Session = Depends(get_session),
):
    return _get_or_404(session, company_id)


@router.post("", response_model=CompanyRead, status_code=status.HTTP_201_CREATED)
def create_company(
    company: CompanyCreate,
    session: Session = Depends(get_session),
):
    db_company = Company.model_validate(company)
    session.add(db_company)
    session.commit()
    session.refresh(db_company)
    return db_company


@router.patch("/{company_id}", response_model=CompanyRead)
def update_company(
    company_id: int,
    company_update: CompanyUpdate,
    session: Session = Depends(get_session),
):
    db_company = _get_or_404(session, company_id)
    update_data = company_update.model_dump(exclude_unset=True)
    db_company.sqlmodel_update(update_data)
    db_company.updated_at = datetime.now(timezone.utc)
    session.add(db_company)
    session.commit()
    session.refresh(db_company)
    return db_company


@router.delete("/{company_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_company(
    company_id: int,
    session: Session = Depends(get_session),
):
    db_company = _get_or_404(session, company_id)
    session.delete(db_company)
    session.commit()

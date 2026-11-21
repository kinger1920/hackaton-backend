from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


class CompanyBase(SQLModel):
    name: str = Field(index=True)
    company_type: str = Field(default="subcontractor", index=True)  # own, client, subcontractor
    trade: Optional[str] = Field(default=None, index=True)  # Gewerk, z. B. "Rohbau", "Maler", "TGA"
    address: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    vob_rules: Optional[str] = None  # Firmenspezifische VOB-Regelungen / BVB
    notes: Optional[str] = None


class Company(CompanyBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CompanyCreate(CompanyBase):
    pass


class CompanyUpdate(SQLModel):
    name: Optional[str] = None
    company_type: Optional[str] = None
    trade: Optional[str] = None
    address: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    vob_rules: Optional[str] = None
    notes: Optional[str] = None


class CompanyRead(CompanyBase):
    id: int
    created_at: datetime
    updated_at: datetime

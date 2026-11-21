"""Firmenliste aus dem Projektformular ↔ Firmen (Company) + Verträge (Contract).

Warum Verträge statt einer JSON-Spalte: Sollstärke-Check, Tagesaufgaben und Briefe lesen Firmen
und Sollstärke aus `Contract`. So wirkt eine Eingabe im Projektformular überall sofort.
Verträge, die aus der Liste verschwinden, werden NICHT gelöscht (sie können ein Vertrags-PDF haben).
"""

from sqlmodel import Session, select

from src.models import Company, Contract, Project
from src.schemas.projects import ContractorIn
from src.services.workforce import tokens


def _same_firm(a: str | None, b: str | None) -> bool:
    return (a or "").strip().lower() == (b or "").strip().lower() or bool(tokens(a) and tokens(a) == tokens(b))


def sync_contractors(session: Session, project: Project, contractors: list[ContractorIn]) -> None:
    """Je Eintrag Firma + Vertrag des Projekts finden oder anlegen und aktualisieren (ohne Commit)."""
    companies = list(session.exec(select(Company)).all())
    contracts = list(session.exec(select(Contract).where(Contract.project_id == project.id)).all())
    for item in contractors:
        name, trade = item.name.strip(), item.trade.strip() or None
        company = next((c for c in companies if _same_firm(c.name, name)), None)
        if company is None:
            company = Company(name=name, trade=trade, company_type="subcontractor", phone=item.phone.strip() or None)
            companies.append(company)
        else:
            company.trade = company.trade or trade
            company.phone = item.phone.strip() or company.phone
        session.add(company)

        contract = next((c for c in contracts if _same_firm(c.contractor_name, name)
                         and (not trade or not c.trade or c.trade.lower() == trade.lower())), None)
        if contract is None:
            contract = Contract(project_id=project.id, title=f"Vertrag {name}" + (f" ({trade})" if trade else ""),
                                contractor_name=name)
            contracts.append(contract)
        contract.trade = trade or contract.trade
        contract.planned_workforce = item.required_workers
        session.add(contract)


def contractors_of(session: Session, project: Project) -> list[ContractorIn]:
    """Verträge des Projekts → Firmenliste im Format des Projektformulars (Telefon aus der Firma)."""
    companies = list(session.exec(select(Company)).all())
    result = []
    for c in session.exec(select(Contract).where(Contract.project_id == project.id).order_by(Contract.id)).all():
        if not c.contractor_name:
            continue
        company = next((x for x in companies if _same_firm(x.name, c.contractor_name)), None)
        result.append(ContractorIn(name=c.contractor_name, trade=c.trade or "", required_workers=c.planned_workforce,
                                   phone=(company.phone if company else None) or ""))
    return result


def with_contractors(session: Session, project: Project) -> dict:
    """Projekt als Antwort-Dict inkl. Firmenliste (für ProjectWithContractors)."""
    return {**project.model_dump(), "contractors": contractors_of(session, project)}

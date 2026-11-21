"""Fortschritt je Vorgang (PlanTask) pro Tagesbericht – Basis für den Soll/Ist-Abgleich.

Eigene Tabelle statt Spalte im Plan: So bleibt nachvollziehbar, an welchem Tag welcher
Stand gemeldet wurde (Ist% eines Vorgangs = letzter gemeldeter Wert bis zum Stichtag).
"""

from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class ReportProgress(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("report_id", "task_id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    report_id: int = Field(foreign_key="dailyreport.id", index=True)
    task_id: int = Field(foreign_key="plantask.id", index=True)
    percent: int = Field(ge=0, le=100)  # Fertigstellungsgrad 0–100 %
    source: str = Field(default="nutzer")  # diktat | ki | regel | nutzer
    note: Optional[str] = None

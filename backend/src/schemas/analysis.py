"""Schemas für Soll/Ist-Analyse, Tagesanalyse und Dashboard.

`PlanAnalysis` folgt 1:1 Jues `frontend/src/analysis/Analysis.tsx` (camelCase), damit die Seite
ihre Beispieldaten direkt ersetzen kann. Alle Zahlen werden in Code berechnet (services/analysis.py).
"""

import datetime as dt
from typing import Literal

from pydantic import BaseModel

DraftType = Literal["delay", "cost", "defect"]
Severity = Literal["critical", "warning", "info"]


class WorkPackage(BaseModel):
    id: str
    name: str
    trade: str
    subcontractor: str
    planDate: str  # Soll-Ende TT.MM.JJJJ
    actualDate: str  # Ist-Ende TT.MM.JJJJ, "offen" oder "Prognose TT.MM.JJJJ"
    planPercent: int
    actualPercent: int
    status: Literal["delayed", "warning", "ontrack"]
    delayDays: float


class DeviationItem(BaseModel):
    id: str
    severity: Severity
    title: str
    sourceReport: str  # Quelle, z. B. "Tagesbericht 17.11.2026"
    reportDate: str
    cause: str
    impact: str
    vobReference: str
    suggestedAction: str
    draftType: DraftType


class ManpowerAvg(BaseModel):
    plan: float
    actual: float


class PlanAnalysis(BaseModel):
    """Antwort von GET /api/analysis (Format Analysis.tsx + Zeitraum/Stichtag)."""

    overallDelta: float  # −größter Verzug in Arbeitstagen
    spi: float  # Schedule Performance Index: Ist-Leistung / Soll-Leistung
    evaluatedReports: int
    criticalAlertsCount: int
    lostHours: float
    manpowerAvg: ManpowerAvg
    workPackages: list[WorkPackage]
    deviations: list[DeviationItem]
    periodFrom: dt.date | None
    periodTo: dt.date
    refDate: dt.date


class DayItem(BaseModel):
    text: str
    source: str


class DayStats(BaseModel):
    workers: int | None
    plannedWorkers: float | None
    hours: float | None
    weather: str | None


class WorkforceSuggestion(BaseModel):
    """Vorschlag: Brief erstellen. prefillText geht als `text` (+ force_type=draftType) an POST /api/capture."""

    draftType: DraftType
    title: str
    prefillText: str


class WorkforceGap(BaseModel):
    """Sollstärke laut Vertrag vs. Ist-Anwesenheit laut Tagesbericht (nur Unterschreitungen)."""

    company: str | None
    trade: str | None
    contractId: int
    contractTitle: str
    planned: int
    actual: int
    shortfallPercent: int
    consecutiveDays: int
    source: str
    contractSource: str
    vobHints: list[str]
    suggestion: WorkforceSuggestion | None = None


class DayAnalysis(BaseModel):
    """Antwort von GET /api/reports/{date}/analysis: Was lief gut, was lief schlecht."""

    date: dt.date
    title: str
    wentWell: list[DayItem]
    wentBadly: list[DayItem]
    deviations: list[DeviationItem]
    stats: DayStats
    mode: Literal["ai", "offline"]
    workforce: list[WorkforceGap] = []


class DashboardKpis(BaseModel):
    delayDays: float
    spi: float
    criticalAlerts: int
    openDrafts: int
    workersToday: int | None


class DashboardAlert(BaseModel):
    severity: Severity
    title: str
    description: str
    draftType: DraftType
    source: str
    prefillText: str | None = None  # gesetzt bei Briefvorschlägen (Sollstärke-Check) → POST /api/capture


class Dashboard(BaseModel):
    """Antwort von GET /api/dashboard (Contract: {kpis, alerts[], progress[]})."""

    kpis: DashboardKpis
    alerts: list[DashboardAlert]
    progress: list[WorkPackage]

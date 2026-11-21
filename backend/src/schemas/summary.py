"""Request-/Response-Schemas für POST /api/summarize.

Zwei Modi:
- Zeitraum: Woche/Monat eines Projekts aus Tagesberichten, Tagebuchnotizen und Briefen.
- Text:     beliebiger Text (E-Mail, Protokoll, Tagebuchauszug).

Die Antwort folgt 1:1 Jues Frontend-Typ `DocumentSummary`
(`frontend/src/context/ProjectDocuments.ts`), deshalb camelCase. Zusätzliche Felder
(Quellen, Statistik, Zeitraum, Modus) sind additiv – das Frontend kann sie ignorieren.
"""

import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field, model_validator

SourceType = Literal["diary", "minutes", "emails"]  # wie DocumentSourceType im Frontend
LinkType = Literal["delay", "cost", "defect"]  # Brieftyp für „Entwurf erstellen“ im Frontend


class SummarizeRequest(BaseModel):
    """Body für POST /api/summarize. Genau ein Modus: `text`, `period` + `project_id` ODER `contract_id`.

    Pydantic prüft das; bei mehreren oder keinem Modus antwortet FastAPI mit 422.
    """

    # Text-Modus
    text: str | None = Field(default=None, description="Freier Text: E-Mail, Protokoll, Tagebuchauszug")
    source_type: SourceType | None = Field(default=None, description="Art des Texts (diary/minutes/emails)")

    # Zeitraum-Modus
    project_id: int | None = Field(default=None, description="Projekt (Pflicht im Zeitraum-Modus)")
    period: Literal["day", "week", "month"] | None = Field(default=None, description="Heute, Woche oder Monat")
    ref_date: dt.date | None = Field(default=None, description="Ein Tag im gewünschten Zeitraum (Default: heute)")

    # Vertrags-Modus
    contract_id: int | None = Field(default=None, description="Vertrag aus Stammdaten zusammenfassen")

    @model_validator(mode="after")
    def _exactly_one_mode(self) -> "SummarizeRequest":
        has_text = bool(self.text and self.text.strip())
        has_period = self.period is not None
        has_contract = self.contract_id is not None
        if sum((has_text, has_period, has_contract)) != 1:
            raise ValueError("Genau einen Modus angeben: 'text', 'period' (+ 'project_id') oder 'contract_id'.")
        if has_period and self.project_id is None:
            raise ValueError("Im Zeitraum-Modus ist 'project_id' Pflicht.")
        return self


class ActionItem(BaseModel):
    """Offener Punkt / Handlungsauftrag (Frontend: ActionItemSummary)."""

    id: str
    task: str
    responsible: str = Field(description="Verantwortlich – leer, wenn nicht genannt")
    deadline: str = Field(description="Frist – leer, wenn nicht genannt")
    priority: Literal["Hoch", "Mittel", "Normal"]
    done: bool = False
    source: str = Field(description="Quelle, z. B. 'Tagesbericht 18.11.2026'")


class VobRisk(BaseModel):
    """VOB-relevantes Risiko (Frontend: VobRiskSummary) + Quelle."""

    title: str
    description: str
    recommendation: str = Field(description="Hinweis, welches Schreiben zu prüfen ist – keine Rechtsberatung")
    linkType: LinkType | None = None
    source: str


class SummaryStats(BaseModel):
    """Kennzahlen des Zeitraums – in Code berechnet, nicht vom LLM."""

    reportDays: int
    workforceHours: float
    avgWorkers: float
    rainDays: int
    incidentDays: int
    noticesByStatus: dict[str, int]


class ContractContact(BaseModel):
    """Ansprechpartner aus Vertrag / Stammdaten für Rückfragen der Bauleitung."""

    name: str
    role: str = ""
    company: str = ""
    phone: str = ""
    email: str = ""
    note: str = ""


class ContractFacts(BaseModel):
    """Strukturierte Eckdaten eines Vertrags (Personal, Wo, Wann, Was, Verantwortliche, Kontakte)."""

    contractTitle: str
    contractorName: str = ""
    trade: str = ""
    statusLabel: str = "Aktiv"
    workforce: str = ""
    location: str = ""
    schedule: str = ""
    scope: str = ""
    projectLeads: list[str] = Field(default_factory=list)
    contacts: list[ContractContact] = Field(default_factory=list)
    vobNotes: str = ""


class SummaryResponse(BaseModel):
    """Antwort von POST /api/summarize (Frontend: DocumentSummary + Zusätze)."""

    title: str
    executiveSummary: list[str]
    keyDecisions: list[str]
    actionItems: list[ActionItem]
    vobRisks: list[VobRisk]
    traceabilityNotes: str

    # Zusätze (additiv)
    keyDecisionSources: list[str] = Field(description="Quelle je Eintrag in keyDecisions (gleiche Reihenfolge)")
    sources: list[str] = Field(description="Alle ausgewerteten Quellen")
    periodFrom: dt.date | None = None
    periodTo: dt.date | None = None
    stats: SummaryStats | None = None
    contractFacts: ContractFacts | None = None
    mode: Literal["ai", "offline"]

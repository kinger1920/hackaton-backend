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
    """Body für POST /api/summarize. Genau ein Modus: `text` ODER `period` + `project_id`.

    Pydantic prüft das; bei beidem oder keinem Modus antwortet FastAPI mit 422.
    """

    # Text-Modus
    text: str | None = Field(default=None, description="Freier Text: E-Mail, Protokoll, Tagebuchauszug")
    source_type: SourceType | None = Field(default=None, description="Art des Texts (diary/minutes/emails)")

    # Zeitraum-Modus
    project_id: int | None = Field(default=None, description="Projekt (Pflicht im Zeitraum-Modus)")
    period: Literal["week", "month"] | None = Field(default=None, description="Woche oder Monat")
    ref_date: dt.date | None = Field(default=None, description="Ein Tag im gewünschten Zeitraum (Default: heute)")

    @model_validator(mode="after")
    def _exactly_one_mode(self) -> "SummarizeRequest":
        has_text = bool(self.text and self.text.strip())
        has_period = self.period is not None
        if has_text == has_period:
            raise ValueError("Entweder 'text' ODER 'period' (+ 'project_id') angeben.")
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
    mode: Literal["ai", "offline"]

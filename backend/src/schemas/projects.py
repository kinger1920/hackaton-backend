"""API-Schemas für Projekt-Stammdaten inkl. Firmenliste aus dem Projektformular (frontend/src/projects).

`contractors` steht nicht als Spalte am Projekt: Jeder Eintrag wird als Firma (Company) +
Vertrag (Contract, Sollstärke = planned_workforce) gespeichert – so greift der Sollstärke-Check.
"""

from pydantic import BaseModel, Field, field_validator

from src.models import ProjectCreate, ProjectRead, ProjectUpdate


class ContractorIn(BaseModel):
    name: str = Field(min_length=1)
    trade: str = ""
    required_workers: int | None = Field(default=None, ge=0, le=500)  # vertragliche Sollstärke
    phone: str = ""

    @field_validator("required_workers", mode="before")
    @classmethod
    def _blank(cls, value):
        return None if isinstance(value, str) and not value.strip() else value


class ProjectCreateIn(ProjectCreate):
    contractors: list[ContractorIn] | None = None


class ProjectUpdateIn(ProjectUpdate):
    contractors: list[ContractorIn] | None = None  # None = Firmenliste unverändert lassen


class ProjectWithContractors(ProjectRead):
    contractors: list[ContractorIn] = []

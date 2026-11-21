"""API-Schemas für POST /api/contracts/{id}/parse (Vertrag parsen → Vorschlag mit Fundstelle)."""

from typing import Literal

from pydantic import BaseModel, Field


class ParsedField(BaseModel):
    """Ein gelesener Wert + wörtliche Fundstelle im Vertrag (Nachvollziehbarkeit, wie Field{value, src})."""

    value: int | str
    src: str = Field(description="Wörtliches Zitat aus dem Vertragstext")


class ContractParseResponse(BaseModel):
    """Vorschlag – wird NICHT gespeichert. Übernahme: PATCH /contracts/{id} mit `suggested_patch`."""

    contract_id: int
    mode: Literal["ai", "offline"]
    fields: dict[str, ParsedField]
    suggested_patch: dict
    current_planned_workforce: int | None

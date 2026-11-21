"""Schemas für Baustellenfotos (/api/photos & /api/photos/describe)."""

import datetime as dt
from typing import Literal

from pydantic import BaseModel


class PhotoDescribeResponse(BaseModel):
    caption: str
    diary_text: str
    issues: list[str]
    mode: Literal["ai", "offline"] = "offline"
    id: int | None = None
    project_id: int | None = None
    report_date: dt.date | None = None
    file_name: str | None = None
    url: str | None = None
    created_at: dt.datetime | None = None


class PhotoOut(BaseModel):
    id: int
    project_id: int
    report_date: dt.date
    file_name: str
    mime_type: str
    url: str
    caption: str
    diary_text: str
    issues: list[str]
    mode: Literal["ai", "offline"] = "offline"
    created_at: dt.datetime

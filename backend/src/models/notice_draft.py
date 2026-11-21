"""Zusatzdaten zu einem Brief-Entwurf (FormalNotice): Felder mit Quelle + Freigabe-Audit.

Eigene Tabelle statt neuer Spalten in `FormalNotice`: SQLite ergänzt neue Spalten in
bestehenden Tabellen nicht automatisch, eine neue Tabelle legt `init_db()` dagegen
selbst an – so braucht niemand einen DB-Reset. 1:1 zu FormalNotice über `notice_id`.
"""

from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class NoticeDraftData(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    notice_id: int = Field(foreign_key="formalnotice.id", unique=True, index=True)

    # JSON-String: {"facts": {"value": "...", "src": "ki"}, ...}  (src: diktat/ki/regel/nutzer)
    fields_json: str = Field(default="{}")

    # Audit der Freigabe ("nichts ohne Freigabe": wer hat wann freigegeben)
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None

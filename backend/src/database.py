import os
from pathlib import Path
from typing import Generator

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

# Base directories
BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"
UPLOADS_DIR = DATA_DIR / "uploads"

# Ensure data and upload directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_DB_FILE = DATA_DIR / "site_assistant.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB_FILE}")

# SQLite specific connect args for multi-threaded FastAPI access
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args=connect_args,
)


@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """Enable WAL mode and Foreign Keys enforcement for SQLite."""
    if DATABASE_URL.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


def init_db() -> None:
    """Creates all database tables defined in SQLModel metadata."""
    # Ensure all models are registered
    try:
        from . import models  # noqa: F401
    except ImportError:
        import src.models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    add_missing_columns(engine)


def add_missing_columns(target: Engine) -> list[str]:
    """Trägt neue, nullable Spalten in bestehende SQLite-Tabellen nach (idempotent).

    Warum: `create_all` legt nur fehlende TABELLEN an, ergänzt aber keine Spalten in
    vorhandenen. Ohne diesen Schritt müsste jeder seine DB löschen, sobald ein Modell ein
    neues Feld bekommt. Nur nullable Spalten ohne Default werden ergänzt (sicher per ALTER).
    Output: Liste der ergänzten Spalten ("tabelle.spalte").
    """
    from sqlalchemy import inspect, text

    added: list[str] = []
    inspector = inspect(target)
    existing_tables = set(inspector.get_table_names())
    with target.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            present = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in present or not column.nullable or column.primary_key:
                    continue
                col_type = column.type.compile(dialect=target.dialect)
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {col_type}'))
                added.append(f"{table.name}.{column.name}")
    return added


def get_session() -> Generator[Session, None, None]:
    """FastAPI dependency for database sessions."""
    with Session(engine) as session:
        yield session

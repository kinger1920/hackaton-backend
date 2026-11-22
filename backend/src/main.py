import sys
from pathlib import Path

# Ensure backend directory is in sys.path so 'src' can be imported regardless of execution working directory
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session

from src.config import settings
from src.database import engine, init_db
from src.frontend_static import mount_frontend
from src.services import demo
from src.services.documents import PDF_UNAVAILABLE_HINT, pdf_available

from src.routers.notes import router as notes_router
from src.routers.plans import router as plans_router
from src.routers.projects import router as projects_router
from src.routers.companies import router as companies_router
from src.routers.contracts import router as contracts_router
from src.routers.contract_parse import router as contract_parse_router
from src.routers.schedule import router as schedule_router
from src.routers.plan_tasks import router as plan_tasks_router
from src.routers.demo import router as demo_router
from src.routers.ai import router as ai_router
from src.routers.notices import router as notices_router
from src.routers.summary import router as summary_router
from src.routers.reports import router as reports_router
from src.routers.analysis import router as analysis_router
from src.routers.photos import router as photos_router
from src.routers.documents import router as documents_router
from src.routers.assistant import router as assistant_router
from src.routers.weather import router as weather_router
from src.routers.progress import router as progress_router
from src.routers.defects import router as defects_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-create tables on startup
    init_db()
    if not pdf_available():
        # Früh und deutlich warnen – sonst merkt man es erst beim Klick auf "PDF" (503).
        logging.getLogger(__name__).warning(PDF_UNAVAILABLE_HINT)
    if settings.demo_seed_on_start:
        # Server mit frischer (leerer) SQLite-Datei: Demo-Stand laden, sonst ist die App leer.
        with Session(engine) as session:
            if demo.seed_if_empty(session):
                logging.getLogger(__name__).info("Leere Datenbank – Demo-Daten geladen.")
    yield


app = FastAPI(
    title="AI Site Manager Assistant API",
    description="Backend API for documentation, daily reports, construction plans, and claims",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        # Deploy: weitere Origins per CORS_ORIGINS (nur bei Frontend auf eigener Domain nötig).
        *settings.cors_origin_list,
    ],
    # Handy im selben WLAN (Frontend über die PC-Adresse, z. B. http://192.168.1.20:3000) – nur private Netze
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}"
                       r"|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(notes_router)
app.include_router(plans_router)
app.include_router(projects_router)
app.include_router(companies_router)
app.include_router(contracts_router)
app.include_router(contract_parse_router)
app.include_router(schedule_router)
app.include_router(plan_tasks_router)
app.include_router(demo_router)
app.include_router(ai_router)
app.include_router(notices_router)
app.include_router(summary_router)
app.include_router(reports_router)
app.include_router(analysis_router)
app.include_router(photos_router)
app.include_router(documents_router)
app.include_router(assistant_router)
app.include_router(weather_router)
app.include_router(progress_router)
app.include_router(defects_router)

# Deploy: gebautes Frontend unter derselben Adresse ausliefern (nur wenn FRONTEND_DIST gesetzt).
if settings.frontend_dist and not mount_frontend(app, settings.frontend_dist):
    logging.getLogger(__name__).warning("FRONTEND_DIST gesetzt, aber index.html fehlt – nur API aktiv.")

@app.get("/")
async def root():
    return {"message": "AI Site Manager Assistant API is running"}


@app.get("/health")
async def health_check():
    # pdf_export: ob WeasyPrint/Pango geladen werden kann (sonst liefert /pdf 503, Word geht immer).
    return {"status": "ok", "pdf_export": pdf_available()}

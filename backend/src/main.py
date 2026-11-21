import sys
from pathlib import Path

# Ensure backend directory is in sys.path so 'src' can be imported regardless of execution working directory
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.database import init_db

from src.routers.notes import router as notes_router
from src.routers.plans import router as plans_router
from src.routers.projects import router as projects_router
from src.routers.contracts import router as contracts_router
from src.routers.ai import router as ai_router
from src.routers.notices import router as notices_router
from src.routers.summary import router as summary_router
from src.routers.reports import router as reports_router
from src.routers.analysis import router as analysis_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-create tables on startup
    init_db()
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
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(notes_router)
app.include_router(plans_router)
app.include_router(projects_router)
app.include_router(contracts_router)
app.include_router(ai_router)
app.include_router(notices_router)
app.include_router(summary_router)
app.include_router(reports_router)
app.include_router(analysis_router)

@app.get("/")
async def root():
    return {"message": "AI Site Manager Assistant API is running"}


@app.get("/health")
async def health_check():
    return {"status": "ok"}

import sys
from pathlib import Path

# Ensure backend directory is in sys.path so 'src' can be imported regardless of execution working directory
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from contextlib import asynccontextmanager
from fastapi import FastAPI
from src.database import init_db

from src.routers.notes import router as notes_router
from src.routers.plans import router as plans_router

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

app.include_router(notes_router)
app.include_router(plans_router)

@app.get("/")
async def root():
    return {"message": "AI Site Manager Assistant API is running"}


@app.get("/health")
async def health_check():
    return {"status": "ok"}

"""Zentrale Einstellungen des Backends.

Liest Werte aus Umgebungsvariablen bzw. aus `backend/.env` – so steht kein
API-Key im Quellcode. Neue Variablen immer auch in `backend/.env.example` eintragen.
"""

import logging
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

# `.env` liegt in `backend/`, egal aus welchem Ordner uvicorn/pytest gestartet wird.
BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # Groq-Key (OpenAI-kompatible API). Optional statt Pflicht: Fehlt er, startet
    # die App trotzdem und alle KI-Endpunkte laufen über die Offline-Regeln.
    groq_api_key: str | None = None
    groq_base_url: str = "https://api.groq.com/openai/v1"

    # Sprachmodell für Extraktion/Review und Speech-to-Text-Modell (beides bei Groq).
    llm_model: str = "openai/gpt-oss-120b"
    stt_model: str = "whisper-large-v3"

    # Nach dieser Zeit (Sekunden) wird der KI-Aufruf abgebrochen und der
    # Offline-Fallback greift (Contract: "LLM-Fehler oder Timeout (8 s) → Fallback").
    llm_timeout_seconds: float = 8.0


settings = Settings()

if not settings.groq_api_key:
    # Nur melden, DASS der Key fehlt – niemals einen Wert loggen.
    logger.warning("GROQ_API_KEY fehlt – KI-Endpunkte laufen im Offline-Modus.")

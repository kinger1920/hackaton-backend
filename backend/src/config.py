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

    # Fester Demo-Nutzer, solange es kein Login gibt: steht in der Briefsignatur
    # und im Freigabe-Audit ("wer hat freigegeben").
    demo_user_name: str = "Bauleiter"
    demo_company: str = "Baupartner AG & Co. KG"

    # POST /api/demo/reset löscht die KOMPLETTE Datenbank und lädt den Demo-Stand.
    # Lokal/für die Jury an; auf einem Server mit echten Daten auf false setzen.
    demo_reset_enabled: bool = True

    # --- Deploy (Docker/Render) ---
    # Zusätzliche erlaubte Browser-Origins für CORS, kommagetrennt
    # (z. B. "https://bauassist.onrender.com"). Nötig nur, wenn das Frontend auf einer
    # ANDEREN Domain läuft als das Backend. Die lokalen Vite-Ports sind immer erlaubt.
    cors_origins: str = ""

    # Ordner mit dem gebauten Frontend (`npm run build` → `frontend/dist`). Gesetzt
    # (im Docker-Image), liefert das Backend die Web-App unter derselben Adresse aus:
    # eine URL fürs Handy, kein CORS. Leer (lokal): Backend liefert nur die API.
    frontend_dist: str | None = None

    # Beim Start Demo-Daten laden, wenn die Datenbank noch leer ist. Für den Server,
    # dessen SQLite-Datei bei jedem Neustart frisch ist (Render Free hat keine Festplatte).
    demo_seed_on_start: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        """`cors_origins` als Liste, ohne Leerzeichen und abschließenden Slash."""
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()


def setup_logging() -> None:
    """Meldungen unserer Module (`src.*`, ab INFO) auf stderr ausgeben – auch im Render-Log.

    Warum: uvicorn richtet nur seine eigenen Logger ein. Ohne eigenen Handler gingen Warnungen
    wie „Wetterdienst nicht erreichbar: HTTP 429“ auf dem Server verloren. Idempotent: mehrfacher
    Aufruf (z. B. bei --reload) hängt keinen zweiten Handler an.
    """
    app_logger = logging.getLogger("src")
    if not any(getattr(h, "_bauassist", False) for h in app_logger.handlers):
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s – %(message)s"))
        handler._bauassist = True  # type: ignore[attr-defined]  – Markierung gegen doppelte Handler
        app_logger.addHandler(handler)
    app_logger.setLevel(logging.INFO)

if not settings.groq_api_key:
    # Nur melden, DASS der Key fehlt – niemals einen Wert loggen.
    logger.warning("GROQ_API_KEY fehlt – KI-Endpunkte laufen im Offline-Modus.")

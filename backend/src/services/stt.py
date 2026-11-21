"""Speech-to-Text: Audio-Diktat → Text (Groq Whisper über das OpenAI-SDK).

Gibt `None` zurück, wenn kein Key gesetzt ist, Groq zu langsam ist (Timeout),
ein Rate-Limit (429) meldet oder ein Fehler auftritt. Dann liefert der Endpunkt
leeren Text, und das Frontend nutzt seine Browser-Spracherkennung.
"""

import asyncio
import logging
import time

import openai

from src.config import settings
from src.services.llm import get_client

logger = logging.getLogger(__name__)


async def transcribe(audio: bytes, filename: str, lang: str | None) -> str | None:
    """Transkribiert eine Audiodatei (webm/m4a/mp3/wav).

    Input:  Datei-Bytes, Dateiname (Whisper erkennt das Format an der Endung), Sprache (z. B. "de", "pl").
    Output: erkannter Text – oder `None` (dann Fallback im Frontend).
    """
    client = get_client()
    if client is None:
        return None

    started = time.perf_counter()
    try:
        result = await asyncio.wait_for(
            client.audio.transcriptions.create(
                model=settings.stt_model,
                file=(filename, audio),
                # Sprache vorgeben macht Whisper schneller und genauer; ohne Angabe erkennt es selbst.
                **({"language": lang} if lang else {}),
            ),
            timeout=settings.llm_timeout_seconds,
        )
    except (asyncio.TimeoutError, openai.APITimeoutError):
        logger.warning("STT-Timeout nach %.1fs – Fallback.", time.perf_counter() - started)
        return None
    except openai.RateLimitError:
        logger.warning("STT-Rate-Limit (429) – Fallback.")  # wie Timeout behandeln
        return None
    except openai.APIStatusError as e:
        logger.warning("STT-API-Fehler %s: %s – Fallback.", e.status_code, e.message)
        return None
    except openai.APIConnectionError:
        logger.warning("Keine Verbindung zu Groq (STT) – Fallback.")
        return None

    logger.info("STT in %.2fs (%s)", time.perf_counter() - started, settings.stt_model)
    return result.text.strip()

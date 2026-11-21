"""Der EINE Wrapper für alle KI-Aufrufe im Backend (Groq über das OpenAI-SDK).

Groq bietet eine OpenAI-kompatible API, deshalb nutzen wir das `openai`-Paket
mit Groqs base_url. Alle KI-Funktionen (Extraktion, Review, Transkription) gehen
über dieses Modul: Timeout, Fehlerbehandlung und Modellwahl sind an genau einer
Stelle geregelt. Gibt eine Funktion `None` zurück, nutzt der Aufrufer seinen
regelbasierten Offline-Fallback.
"""

import asyncio
import logging
import time
from typing import TypeVar

import openai
from pydantic import BaseModel

from src.config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

_client: openai.AsyncOpenAI | None = None

# Token-Verbrauch des letzten erfolgreichen Chat-Aufrufs. Wird vom Test-Runner
# genutzt, um unter dem Groq-Limit (Tokens pro Minute) zu bleiben.
last_total_tokens: int = 0


def get_client() -> openai.AsyncOpenAI | None:
    """Erzeugt den Groq-Client einmalig (lazy). Ohne API-Key → None (Offline-Modus)."""
    global _client
    if not settings.groq_api_key:
        return None
    if _client is None:
        _client = openai.AsyncOpenAI(
            api_key=settings.groq_api_key,
            base_url=settings.groq_base_url,
            # Keine automatischen Retries: Ein Retry (z. B. nach 429) würde unser
            # 8-s-Budget sprengen. Lieber sofort auf die Offline-Regeln ausweichen.
            max_retries=0,
            timeout=settings.llm_timeout_seconds,
        )
    return _client


async def complete_json(system: str, user: str, schema: type[T], max_tokens: int = 2048) -> T | None:
    """Fragt das LLM und bekommt eine Antwort, die exakt zum Pydantic-Schema passt.

    Input:  System-Prompt (Regeln), User-Text (z. B. Diktat), Ziel-Schema.
    Output: validierte Instanz von `schema` – oder `None`, wenn kein Key gesetzt ist,
            das Modell zu lange braucht (> LLM_TIMEOUT_SECONDS), Groq 429 (Rate-Limit)
            meldet, ablehnt oder ein API-/Netzwerkfehler auftritt.
            `None` heißt für den Aufrufer: Offline-Fallback nutzen.

    Warum JSON-Schema-Output: Das Modell darf nur die Felder füllen, die wir vorgeben.
    So landet nie freier Text in einem Feld, das Code später weiterverarbeitet.
    """
    global last_total_tokens
    client = get_client()
    if client is None:
        return None

    started = time.perf_counter()
    try:
        # asyncio.wait_for ist die harte Obergrenze für den ganzen Aufruf
        # (inkl. Verbindungsaufbau) – das SDK-Timeout allein deckt nicht alles ab.
        completion = await asyncio.wait_for(
            client.chat.completions.parse(
                model=settings.llm_model,
                max_completion_tokens=max_tokens,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                # Das SDK wandelt das Pydantic-Modell in ein striktes JSON-Schema um
                # und validiert die Antwort wieder zurück in das Modell.
                response_format=schema,
                # Wenig "Nachdenken" = schnelle Antwort; Feld-Extraktion braucht das nicht.
                reasoning_effort="low",
            ),
            timeout=settings.llm_timeout_seconds,
        )
    except (asyncio.TimeoutError, openai.APITimeoutError):
        logger.warning("LLM-Timeout nach %.1fs – Offline-Fallback.", time.perf_counter() - started)
        return None
    except openai.RateLimitError:
        # 429 = Groq-Limit (Requests/Tokens pro Minute) erreicht. Wie ein Timeout
        # behandeln: nicht warten, sondern sofort Offline-Fallback.
        logger.warning("LLM-Rate-Limit (429) – Offline-Fallback.")
        return None
    except openai.AuthenticationError:
        logger.error("Groq lehnt den API-Key ab (401) – Offline-Fallback.")
        return None
    except openai.APIStatusError as e:
        # e.message enthält nur die Fehlerbeschreibung der API, keinen Key.
        logger.warning("LLM-API-Fehler %s: %s – Offline-Fallback.", e.status_code, e.message)
        return None
    except openai.APIConnectionError:
        logger.warning("Keine Verbindung zu Groq – Offline-Fallback.")
        return None
    except Exception:  # z. B. Validierungsfehler beim Parsen – Demo darf nie abstürzen
        logger.exception("Unerwarteter Fehler beim LLM-Aufruf – Offline-Fallback.")
        return None

    elapsed = time.perf_counter() - started
    last_total_tokens = completion.usage.total_tokens if completion.usage else 0
    logger.info("LLM-Antwort in %.2fs, %d Tokens (%s)", elapsed, last_total_tokens, settings.llm_model)

    message = completion.choices[0].message
    if message.refusal or message.parsed is None:
        logger.warning("LLM lieferte kein verwertbares JSON (refusal=%s).", bool(message.refusal))
        return None
    return message.parsed

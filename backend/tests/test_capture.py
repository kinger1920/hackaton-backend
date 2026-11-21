"""Offline-Tests für /api/capture-Logik: Fallbacks bei fehlendem Key, 429 und Timeout.

Laufen ohne Netz und ohne Tokenverbrauch (der Groq-Client wird durch Fakes ersetzt).
"""

import asyncio

import httpx2 as httpx  # das openai-SDK 3.x nutzt httpx2
import openai
import pytest

from src.config import settings
from src.schemas.ai import CaptureRequest
from src.services import extraction, llm, offline_rules

PL_TEXT = "Koparka stoi od 10:00, bo brakuje planów sieci od inwestora. Oś B."


class _FakeCompletions:
    """Ersetzt client.chat.completions; `parse` wirft die übergebene Exception."""

    def __init__(self, exc: Exception):
        self._exc = exc

    async def parse(self, **kwargs):
        raise self._exc


class _FakeClient:
    def __init__(self, exc: Exception):
        self.chat = type("Chat", (), {"completions": _FakeCompletions(exc)})()


def _capture(text: str = PL_TEXT):
    return asyncio.run(extraction.capture(CaptureRequest(text=text, lang="pl", ref_date="2026-11-21")))


def test_no_key_uses_offline(monkeypatch):
    monkeypatch.setattr(settings, "groq_api_key", None)
    monkeypatch.setattr(llm, "_client", None)
    draft = _capture()
    assert draft.mode == "offline"
    assert draft.type == "delay"  # "stoi" / "brak" → Behinderung
    assert draft.fields["facts"].src == "diktat"
    assert draft.fields["start_time"].value == "10:00"


def test_rate_limit_429_is_treated_like_timeout(monkeypatch):
    request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    exc = openai.RateLimitError("rate limit", response=httpx.Response(429, request=request), body=None)
    monkeypatch.setattr(llm, "get_client", lambda: _FakeClient(exc))
    draft = _capture()
    assert draft.mode == "offline"


def test_timeout_uses_offline(monkeypatch):
    monkeypatch.setattr(llm, "get_client", lambda: _FakeClient(asyncio.TimeoutError()))
    assert _capture().mode == "offline"


def test_missing_required_fields_create_questions(monkeypatch):
    monkeypatch.setattr(llm, "get_client", lambda: None)
    draft = _capture("Bagger steht.")
    # Offline kennen wir weder Ursache noch Ort → Rückfragen dazu.
    assert any("Ursache" in q for q in draft.questions)
    assert any("Wo genau" in q for q in draft.questions)


@pytest.mark.parametrize(
    "text,expected",
    [("Riss in der Wand", "defect"), ("Mehrkosten für Zusatztür", "cost"), ("Bedenken gegen Dämmung", "concern")],
)
def test_offline_classify(text, expected):
    assert offline_rules.classify(text) == expected

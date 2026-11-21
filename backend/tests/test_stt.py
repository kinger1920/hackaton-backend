"""Tests für POST /api/transcribe ohne Netz: Groq-Client wird durch einen Fake ersetzt."""

import asyncio

import httpx2 as httpx
import openai
import pytest

from src.config import settings
from src.services import stt

AUDIO = {"audio": ("diktat.m4a", b"fake-audio-bytes", "audio/mp4")}


class _FakeClient:
    """Minimaler Ersatz für AsyncOpenAI: nur `audio.transcriptions.create`."""

    def __init__(self, behavior):
        self.calls: list[dict] = []
        outer = self

        class _Transcriptions:
            async def create(self, **kwargs):
                outer.calls.append(kwargs)
                return await behavior()

        self.audio = type("Audio", (), {"transcriptions": _Transcriptions()})()


def _use(monkeypatch, behavior) -> _FakeClient:
    fake = _FakeClient(behavior)
    monkeypatch.setattr(stt, "get_client", lambda: fake)
    return fake


def test_success_returns_trimmed_text(client, monkeypatch):
    async def ok():
        return type("R", (), {"text": "  Bagger steht seit 10 Uhr.  "})()

    fake = _use(monkeypatch, ok)
    r = client.post("/api/transcribe", files=AUDIO, data={"lang": "pl"})
    assert r.status_code == 200
    assert r.json() == {"text": "Bagger steht seit 10 Uhr.", "lang": "pl"}
    assert fake.calls[0]["language"] == "pl"
    assert fake.calls[0]["model"] == settings.stt_model
    assert fake.calls[0]["file"] == ("diktat.m4a", b"fake-audio-bytes")


def test_no_key_falls_back_to_empty_text(client):
    # conftest schaltet den Groq-Client ab (kein Key) → leerer Text, Status 200.
    r = client.post("/api/transcribe", files=AUDIO, data={"lang": "de"})
    assert r.status_code == 200
    assert r.json() == {"text": "", "lang": "de"}


def _connection_error():
    raise openai.APIConnectionError(request=httpx.Request("POST", "https://api.groq.com"))


def _unexpected_error():
    raise RuntimeError("kaputt")


@pytest.mark.parametrize("error", [_connection_error, _unexpected_error], ids=["groq-down", "unexpected"])
def test_errors_fall_back_to_empty_text(client, monkeypatch, error):
    async def fail():
        error()

    _use(monkeypatch, fail)
    r = client.post("/api/transcribe", files=AUDIO, data={"lang": "de"})
    assert r.status_code == 200
    assert r.json()["text"] == ""


def test_timeout_falls_back(client, monkeypatch):
    async def slow():
        await asyncio.sleep(1)

    _use(monkeypatch, slow)
    monkeypatch.setattr(settings, "llm_timeout_seconds", 0.05)
    r = client.post("/api/transcribe", files=AUDIO, data={"lang": "de"})
    assert r.status_code == 200
    assert r.json()["text"] == ""

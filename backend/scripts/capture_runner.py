"""Live-Test-Runner für die Diktat-Extraktion (ruft Groq wirklich auf, kostet Tokens).

Aufruf:  cd backend && uv run python scripts/capture_runner.py [--only pl]
Misst je Diktat: Latenz, Modus (ai/offline), Typ, Felder, Rückfragen.
Wartet zwischen den Aufrufen, damit wir unter dem Groq-Limit von 8.000 Tokens/Minute bleiben.
"""

import argparse
import asyncio
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # damit `src` importierbar ist

from src.schemas.ai import CaptureRequest  # noqa: E402
from src.services import extraction, llm  # noqa: E402

TOKENS_PER_MINUTE = 8_000

# (Kürzel, Sprache, Text, erwarteter Typ)
DICTATIONS = [
    ("pl", "pl", "Koparka stoi od 10:00, bo brakuje planów sieci od inwestora. Oś B, wykop fundamentowy.", "delay"),
    ("de-delay", "de", "Bagger steht seit 10 Uhr, Leitungspläne vom Bauherrn fehlen, Baugrube Achse B.", "delay"),
    ("de-defect", "de", "Riss in der Bodenplatte Haus C, Nachunternehmer Müller Bau soll bis 28.11. nachbessern.", "defect"),
    ("de-cost", "de", "Bauherr will zusätzlich eine zweite Kellertür, Mehrkosten ca. 4.500 Euro, Keller Achse 3.", "cost"),
    ("de-concern", "de", "Bedenken: Dämmstärke im Dach reicht für die geplante PV-Auflast nicht, Vorgabe Architekt.", "concern"),
]


async def main(only: str | None) -> None:
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    items = [d for d in DICTATIONS if only is None or d[0] == only]
    correct = 0
    for i, (key, lang, text, expected) in enumerate(items):
        llm.last_total_tokens = 0
        started = time.perf_counter()
        draft = await extraction.capture(CaptureRequest(text=text, lang=lang, ref_date="2026-11-21"))
        latency = time.perf_counter() - started
        tokens = llm.last_total_tokens
        ok = draft.type == expected
        correct += ok

        print(f"\n=== {key} ({lang}) – {latency:.2f}s, {tokens} Tokens, mode={draft.mode}, "
              f"type={draft.type} {'OK' if ok else f'FALSCH (erwartet {expected})'}")
        for name, f in draft.fields.items():
            print(f"  {name:14} [{f.src:6}] {f.value}")
        if draft.questions:
            print("  Rückfragen:", " | ".join(draft.questions))

        # Rate-Limit einhalten: verbrauchte Tokens / (8000 pro 60 s) = nötige Pause.
        if i < len(items) - 1 and tokens:
            pause = tokens / TOKENS_PER_MINUTE * 60 + 0.5
            print(f"  … warte {pause:.1f}s (Token-Limit)")
            await asyncio.sleep(pause)

    print(f"\nErgebnis: {correct}/{len(items)} Typen korrekt")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="nur dieses Diktat-Kürzel, z. B. pl")
    asyncio.run(main(parser.parse_args().only))

#!/usr/bin/env bash
# Startet das Backend lokal – für alle im Team gleich (auch aus PyCharm/VS Code-Terminals).
# Warum: WeasyPrint (PDF-Export) braucht auf macOS den Suchpfad zu Homebrews Pango.
# Der muss VOR dem Start von Python gesetzt sein; ~/.zshrc wird z. B. von IDEs nicht gelesen.
# Aufruf:  cd backend && ./scripts/dev.sh            (weitere uvicorn-Optionen anhängbar, z. B. --port 8001)
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname)" == "Darwin" && -z "${DYLD_FALLBACK_LIBRARY_PATH:-}" ]]; then
  for dir in /opt/homebrew/lib /usr/local/lib; do  # Apple Silicon bzw. Intel-Mac
    if [[ -e "$dir/libgobject-2.0.0.dylib" ]]; then
      export DYLD_FALLBACK_LIBRARY_PATH="$dir"
      break
    fi
  done
fi

# --env-file: ALLE Werte aus backend/.env landen in der Umgebung – auch DATABASE_URL, das
# src/database.py direkt aus der Umgebung liest (nicht über config.py).
env_args=()
[[ -f .env ]] && env_args=(--env-file .env)

exec uv run uvicorn src.main:app --reload "${env_args[@]}" "$@"

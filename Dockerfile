# Ein Image für die ganze App: baut das Frontend (Vite) und startet das Backend (FastAPI),
# das Web-App UND API unter derselben Adresse ausliefert. Deploy z. B. auf Render (render.yaml).
#
# Lokal testen (Docker nötig):
#   docker build -t bauassist .
#   docker run --rm -p 8000:8000 --env-file backend/.env bauassist   → http://localhost:8000

# ---------- Stufe 1: Frontend bauen ----------
FROM node:24-slim AS frontend
WORKDIR /app/frontend

# Erst nur die Paketlisten kopieren: Docker cached `npm ci`, solange sie sich nicht ändern.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
# API-Adresse fürs Frontend. "/." = dieselbe Domain wie die Seite: `api.ts` baut daraus
# "/./api/..." und der Browser macht "/api/..." daraus. (Leer würde auf localhost:8000
# zurückfallen.) Nur für ein Frontend auf eigener Domain eine volle URL setzen.
ARG VITE_API_URL=/.
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build


# ---------- Stufe 2: Backend ----------
FROM python:3.15-slim-trixie

# Systembibliotheken für den PDF-Export (WeasyPrint braucht Pango/HarfBuzz) und
# Schriften: Liberation ersetzt Arial/Helvetica aus den Briefvorlagen maßgleich.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 fonts-liberation fontconfig \
    && rm -rf /var/lib/apt/lists/*

# uv in fester Version (wie im Team, siehe AGENTS.md) – installiert exakt die Pakete aus uv.lock.
COPY --from=ghcr.io/astral-sh/uv:0.13.9 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1

WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/ ./
COPY --from=frontend /app/frontend/dist /app/frontend/dist

# Deploy-Einstellungen (siehe src/config.py). Secrets wie GROQ_API_KEY kommen NICHT ins
# Image, sondern als Umgebungsvariable der Plattform.
ENV PATH="/app/backend/.venv/bin:$PATH" \
    FRONTEND_DIST=/app/frontend/dist \
    DEMO_SEED_ON_START=true

EXPOSE 8000
# Render/Railway geben den Port über $PORT vor; lokal 8000.
CMD ["sh", "-c", "uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]

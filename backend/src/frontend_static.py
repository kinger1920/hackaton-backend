"""Liefert das gebaute Frontend (Vite, `frontend/dist`) über das Backend aus – nur im Deploy.

Warum: Frontend und API unter EINER Adresse = eine HTTPS-URL fürs Handy und kein CORS.
Aktiv nur, wenn `FRONTEND_DIST` gesetzt ist (Docker-Image); lokal bleibt alles wie bisher.
"""

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response
from starlette.staticfiles import StaticFiles

# Diese Pfade gehören immer dem Backend, auch wenn ein Browser sie direkt aufruft.
_BACKEND_ONLY = ("/api/", "/docs", "/redoc", "/openapi.json", "/health")


def _wants_page(request: Request) -> bool:
    """True, wenn der Browser eine SEITE lädt (Adresszeile, Reload, Link) statt Daten.

    Warum über den Accept-Header: Frontend-Routen wie `/projects` heißen genauso wie
    Backend-Routen (`GET /projects` liefert JSON). `fetch()` aus der App schickt kein
    `text/html` im Accept-Header, ein Seitenaufruf im Browser schon.
    """
    if request.method != "GET":
        return False
    if request.url.path.startswith(_BACKEND_ONLY):
        return False
    return "text/html" in request.headers.get("accept", "")


def mount_frontend(app: FastAPI, dist_dir: str | Path) -> bool:
    """Hängt das gebaute Frontend an die App. Input: Ordner mit `index.html` + `assets/`.

    Output: True, wenn eingebunden; False, wenn der Ordner fehlt (dann nur API, kein Absturz).
    """
    dist = Path(dist_dir)
    index = dist / "index.html"
    if not index.is_file():
        return False
    dist_root = dist.resolve()

    class SpaFallback(BaseHTTPMiddleware):
        """Seitenaufrufe → index.html; React Router zeigt dann die richtige Seite."""

        async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
            path = request.url.path
            if request.method == "GET" and not path.startswith(_BACKEND_ONLY) and path != "/":
                # Echte Dateien aus dist (Bilder/Icons aus `public/`) direkt liefern.
                # resolve + is_relative_to: kein Zugriff außerhalb von dist (z. B. "/../.env").
                candidate = (dist / path.lstrip("/")).resolve()
                if candidate.is_file() and candidate.is_relative_to(dist_root):
                    return FileResponse(candidate)
            if _wants_page(request):
                return FileResponse(index)
            return await call_next(request)

    app.add_middleware(SpaFallback)
    # JS/CSS-Bundles (Vite legt sie unter /assets/ ab, Dateinamen mit Hash).
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="frontend-assets")
    return True

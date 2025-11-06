# feed/views.py
"""
API JSON del feed: notificación incremental de canciones nuevas para «muro» y
«catálogo» mediante polling.
"""

from datetime import timedelta

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.urls import reverse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.http import require_GET

from inicio_sesion.models import Song

# ---------------------------------------------------------------------------
# Resolución de rol (compatible con la infraestructura de «inicio_sesion»)
# ---------------------------------------------------------------------------
try:
    from inicio_sesion.auth_helpers import _get_user_role as _role_by_username, _require_session_user

    def _resolve_role(request) -> str:
        username = _require_session_user(request)
        return (_role_by_username(username) if username else "viewer").lower()
except Exception:

    def _resolve_role(request) -> str:
        u = getattr(request, "user", None)
        if not u or not getattr(u, "is_authenticated", False):
            return "viewer"
        return "admin" if getattr(u, "is_superuser", False) else "artist"


# ---------------------------------------------------------------------------
# Serialización y utilidades
# ---------------------------------------------------------------------------
def _abs_url(request, f) -> str:
    """Devuelve la URL absoluta de un FieldFile; vacío si no es accesible."""
    if not f:
        return ""
    try:
        return request.build_absolute_uri(f.url)
    except Exception:
        return ""


def _serialize_song(s: Song, request, view: str = "owner") -> dict:
    """
    Serializa una instancia de Song para el feed.

    view:
        - "owner": URLs de edición/eliminación del artista (muro).
        - "admin": URLs de gestión (catálogo).
    """
    audio_url = _abs_url(request, getattr(s, "audio_file", None))
    cover_url = _abs_url(request, getattr(s, "cover_image", None))
    artist_display = getattr(s, "artist_display_name", "") or getattr(s, "artist", "") or ""
    genre = getattr(s, "genre", "") or getattr(s, "genero", "") or getattr(s, "genre_name", "")
    created_at = getattr(s, "created_at", None)

    editar_url = eliminar_url = ""
    try:
        if view == "owner":
            editar_url = reverse("editar_mi_cancion_en_muro", args=[s.id])
            eliminar_url = reverse("eliminar_mi_cancion", args=[s.id])
        else:
            editar_url = reverse("editar_cancion", args=[s.id])
            eliminar_url = reverse("eliminar_cancion", args=[s.id])
    except Exception:
        pass

    return {
        "id": s.id,
        "title": getattr(s, "title", ""),
        "artist_display_name": artist_display,
        "genre": genre,
        "created_at": timezone.localtime(created_at).isoformat() if created_at else "",
        "audio_url": audio_url,
        "cover_url": cover_url,
        "editar_url": editar_url,
        "eliminar_url": eliminar_url,
        "owner_user": getattr(s, "owner_user", "") or getattr(getattr(s, "owner", None), "user", "") or "",
    }


# ---------------------------------------------------------------------------
# Endpoint de cambios
# ---------------------------------------------------------------------------
@login_required
@require_GET
def songs_changes(request):
    """
    Cambios recientes en canciones para polling incremental.

    Parámetros de consulta:
        - scope: "muro" | "catalogo" (por defecto "muro").
        - since: ISO8601 exclusivo (por defecto, ahora - 15 minutos).
        - artist: nombre del artista (sólo «muro»); opcional.
        - limit: entero [1..100] (por defecto 20).
        - view: "owner" | "admin". Si no se indica, se infiere del rol.
    Respuesta:
        JSON con { ok, count, latest_created_at, items }.
    """
    scope = (request.GET.get("scope") or "muro").lower()
    view_param = (request.GET.get("view") or "").lower()
    inferred_view = "owner" if _resolve_role(request) == "artist" else "admin"
    view = view_param if view_param in {"owner", "admin"} else inferred_view

    artist = (request.GET.get("artist") or "").strip()

    try:
        limit = int(request.GET.get("limit", 20))
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 100))

    since_raw = (request.GET.get("since") or "").strip()
    since = parse_datetime(since_raw) if since_raw else None
    if since and timezone.is_naive(since):
        since = timezone.make_aware(since, timezone.get_current_timezone())
    if not since:
        since = timezone.now() - timedelta(minutes=15)

    qs = Song.objects.all()
    if scope == "muro" and artist:
        qs = qs.filter(artist_display_name=artist)

    qs = qs.filter(created_at__gt=since).order_by("-created_at")[:limit]

    items = [_serialize_song(s, request, view=view) for s in qs]
    latest = None
    if items:
        latest = max((it.get("created_at") or "") for it in items) or None

    return JsonResponse(
        {
            "ok": True,
            "count": len(items),
            "latest_created_at": latest,
            "items": items,
        }
    )

# muro/views_artist.py
"""
Vistas del muro del artista: públicas y privadas (propias), con CRUD de canciones
y soporte de deshacer usando estado en sesión.

Este módulo usa helpers y modelos de la app `inicio_sesion`.
"""

import json
import os
import re
from hashlib import sha256
from pathlib import Path
from typing import Optional
from uuid import uuid4

from django.contrib import messages
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import transaction
from django.http import HttpResponse, HttpResponseBadRequest, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_http_methods

# Dependencias del proyecto (importes absolutos)
from inicio_sesion import base as base
from inicio_sesion.auth_helpers import _get_user_role, _is_artist, _require_session_user
from inicio_sesion.models import ArtistProfile, Song, Users


# =============================================================================
# Config / Constantes
# =============================================================================

_MAX_FILES = 30
_MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB
_ALLOWED_EXTS = {"mp3", "wav", "ogg", "m4a", "flac"}

STRICT_TITLE_FILTER = True  # heurística de depuración de títulos


# =============================================================================
# Helpers de storage/archivos
# =============================================================================

def _storage():
    """Devuelve el storage configurado para audio y portadas."""
    return getattr(base, "_AUDIO_STORAGE", default_storage)


def _safe_base_url() -> str:
    """Obtiene el base_url del storage (o cadena vacía si no hay)."""
    try:
        bu = getattr(_storage(), "base_url", "") or ""
        return bu.rstrip("/")
    except Exception:
        return ""


def _rel_from_storage_url(url: str) -> Optional[str]:
    """
    Convierte una URL servida por el storage a la ruta relativa almacenada.
    Retorna None si la URL no pertenece al storage o no hay base_url.
    """
    if not url:
        return None
    base_url = _safe_base_url()
    if not base_url:
        return None
    s = str(url)
    prefix = base_url + "/"
    if s.startswith(prefix):
        return s[len(prefix):].lstrip("/")
    return None


def _delete_storage_entry(file_or_url) -> None:
    """
    Elimina del storage a partir de `FieldFile.name` o de una URL del storage.
    Operación best-effort: errores ignorados.
    """
    try:
        name = getattr(file_or_url, "name", "") or _rel_from_storage_url(str(file_or_url) or "")
        if name:
            _storage().delete(name)
    except Exception:
        pass


def _delete_song_files(song: Song) -> None:
    """Elimina del storage los archivos asociados a una canción (audio y portada)."""
    storage = _storage()
    try:
        name = getattr(song.audio_file, "name", "") or _rel_from_storage_url(str(song.audio_file) or "")
        if name:
            storage.delete(name)
    except Exception:
        pass
    try:
        if getattr(song, "cover_image", None):
            cname = getattr(song.cover_image, "name", "") or _rel_from_storage_url(str(song.cover_image) or "")
            if cname:
                storage.delete(cname)
    except Exception:
        pass


def _safe_file_url(field) -> str:
    """Obtiene una URL utilizable para un FieldFile (robusta a backends sin url)."""
    if not field:
        return ""
    try:
        return field.url
    except Exception:
        try:
            name = getattr(field, "name", "") or ""
            if name and hasattr(_storage(), "url"):
                return _storage().url(name)
        except Exception:
            pass
    return str(field) if field else ""


# =============================================================================
# Helpers de UNDO (muro del artista)
# =============================================================================

def _put_undo_muro(request, label: str, data: dict) -> None:
    """Guarda en sesión el último cambio del muro para permitir revertirlo."""
    request.session["mi_muro_undo"] = data
    request.session["mi_muro_undo_label"] = label
    request.session.modified = True


def _clear_undo_muro(request) -> None:
    """Limpia el estado de deshacer del muro en la sesión."""
    request.session.pop("mi_muro_undo", None)
    request.session.pop("mi_muro_undo_label", None)
    request.session.modified = True


# =============================================================================
# Vistas del muro
# =============================================================================

@require_http_methods(["GET"])
def muro_publico(request, username: str):
    """
    Renderiza el muro público de un artista (canciones visibles + descripción).

    Contexto adicional si hay sesión iniciada:
      - Datos básicos del usuario en sesión (avatar, descripción si artista, fecha).
      - Estructura de playlists JSON para integrar con el reproductor del Home.
    """
    artist = get_object_or_404(Users, user=username, type__iexact="artista")
    try:
        prof = artist.artist_profile
        wall_description = (prof.description or "").strip()
    except ArtistProfile.DoesNotExist:
        wall_description = ""

    songs = Song.objects.filter(owner_user=username, visibility="public").only(
        "id", "title", "artist_display_name", "created_at", "cover_image", "audio_file", "genre"
    )

    session_user = request.session.get("user", "")
    session_role = request.session.get("role", "")
    role_lower = (session_role or "").lower()

    session_avatar_url = ""
    session_artist_desc = ""
    session_created_at = ""
    if session_user:
        try:
            u = Users.objects.get(user=session_user)
            if getattr(u, "avatar", None):
                session_avatar_url = _safe_file_url(u.avatar)
            if getattr(u, "created_at", None):
                session_created_at = u.created_at.strftime("%Y-%m-%d %H:%M")
            if role_lower == "artista":
                try:
                    session_artist_desc = (u.artist_profile.description or "").strip()
                except ArtistProfile.DoesNotExist:
                    session_artist_desc = ""
        except Users.DoesNotExist:
            pass

    # Prepara playlists JSON para el reproductor si el usuario en sesión es artista
    playlists = []
    if role_lower == "artista" and session_user:
        qs = Song.objects.filter(owner_user=session_user, visibility="public").only(
            "id", "title", "artist_display_name", "audio_file", "cover_image", "genre"
        )
        songs_json = [
            {
                "id": s.id,
                "title": s.title,
                "author": s.artist_display_name,
                "audioUrl": _safe_file_url(s.audio_file),
                "coverUrl": _safe_file_url(s.cover_image) or None,
                "genre": getattr(s, "genre", "") or "",
            }
            for s in qs
        ]
        playlists.append({"id": 1, "name": "Mi música", "songs": songs_json})

    # Estado de UNDO (sólo si lo generó el propietario en sesión)
    undo_muro_data = request.session.get("mi_muro_undo")
    if undo_muro_data and undo_muro_data.get("owner") != session_user:
        undo_muro_data = None
    undo_muro_label = request.session.get("mi_muro_undo_label") if undo_muro_data else None

    ctx = {
        "artist": artist,
        "description": wall_description,
        "songs": songs,
        "is_owner": (session_user == username),
        "session_user": session_user,
        "session_role": session_role,
        "session_avatar_url": session_avatar_url,
        "session_description": session_artist_desc,
        "session_created_at": session_created_at,
        "playlists_json": json.dumps(playlists),
        "initial_view": "mi-muro",
        "undo_muro_data": undo_muro_data,
        "undo_muro_label": undo_muro_label,
    }
    return render(request, "muro/muro_artista.html", ctx)


@require_http_methods(["GET"])
def mi_muro(request):
    """Redirige al muro del artista autenticado. Requiere rol de artista."""
    username = _require_session_user(request)
    if not username:
        return redirect("login")
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)
    return muro_publico(request, username)


# =============================================================================
# Acciones sobre canciones propias (muro)
# =============================================================================

@require_http_methods(["POST"])
def subir_cancion_en_muro(request):
    """
    Sube una canción al muro del artista autenticado.

    Validaciones:
      - Título, intérprete y archivo de audio obligatorios.
      - Duplicados por título para el mismo propietario.
      - Duplicados por hash SHA-256 del audio.
      - Tamaño máximo de 10 MB.
    Respuesta JSON (si X-Requested-With=fetch) o redirección a mi_muro.
    """
    username = _require_session_user(request)
    if not username:
        return redirect("login")
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)

    is_fetch = (request.headers.get("x-requested-with", "") or "").lower() == "fetch"

    def _json_err(msg, status=400):
        """Atajo para respuestas JSON de error en flujos fetch."""
        return JsonResponse({"ok": False, "error": msg}, status=status)

    title = (request.POST.get("title") or "").strip()
    artist_display_name = (request.POST.get("artist_display_name") or "").strip()
    genre = (request.POST.get("genre") or "").strip()
    audio = request.FILES.get("audio_file")
    cover = request.FILES.get("cover_image")

    # --- Filtro/normalización de título (heurística) ---
    if not title:
        if audio:
            candidate = _title_candidate_from_filename(audio.name)
            ok_title, why = _title_is_sensible(candidate)
            if ok_title:
                title = candidate
            else:
                msg = f"Título inválido ({why}). Renombra el archivo o escribe un título legible."
                return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")
    else:
        ok_title, why = _title_is_sensible(title)
        if ok_title:
            _tokens = title.split()
            if len(_tokens) == 1 and len(_tokens[0]) >= 15:
                ok_title = False
                why = "un solo bloque muy largo; separa en palabras"
        if not ok_title:
            candidate = None
            if audio:
                cand = _title_candidate_from_filename(audio.name)
                ok2, _ = _title_is_sensible(cand)
                if ok2:
                    candidate = cand

            if is_fetch:
                return JsonResponse(
                    {
                        "ok": False,
                        "error": (
                            f"Título no válido ({why})."
                            + (f" Sugerencia: “{candidate}”." if candidate else " Escribe un título legible.")
                        ),
                        "suggested_title": candidate or "",
                    },
                    status=400,
                )
            else:
                msg = (
                    f"Título no válido ({why})."
                    + (f" Sugerencia: “{candidate}”." if candidate else " Escribe un título legible.")
                )
                return _redirect_error(request, msg, "mi_muro")

    if not artist_display_name or audio is None:
        msg = "Intérprete y archivo de audio son obligatorios."
        return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")

    if Song.objects.filter(owner_user=username, visibility="public", title__iexact=title).exists():
        msg = "Ya tienes una canción con ese título."
        return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")

    if getattr(audio, "size", 0) > 10 * 1024 * 1024:
        msg = "El archivo excede 10 MB."
        return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")

    # Calcula hash del audio para prevenir duplicados exactos
    audio_digest = _sha256_file(audio)

    if audio_digest and Song.objects.filter(
        owner_user=username, visibility="public", audio_sha256=audio_digest
    ).exists():
        msg = "Ya subiste este mismo audio antes."
        return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")

    storage = _storage()
    try:
        audio_ext = Path(audio.name).suffix or ""
        audio_name = f"audio_{username}_{uuid4().hex}{audio_ext}"

        cover_name = None
        if cover:
            cover_ext = Path(cover.name).suffix or ""
            cover_name = f"cover_{username}_{uuid4().hex}{cover_ext}"

        with transaction.atomic():
            saved_audio = storage.save(audio_name, audio)
            saved_cover = storage.save(cover_name, cover) if cover_name else None

            song = Song.objects.create(
                title=title,
                artist_display_name=artist_display_name,
                owner_user=username,
                audio_file=saved_audio,
                cover_image=(saved_cover or None),
                audio_sha256=audio_digest,
                visibility="public",
                genre=genre,
            )

        undo_label = f"Se subió “{song.title}”."
        _put_undo_muro(
            request,
            undo_label,
            {"kind": "delete_song", "song_id": song.id, "owner": username},
        )

        if is_fetch:
            return JsonResponse(
                {
                    "ok": True,
                    "song": {
                        "id": song.id,
                        "title": song.title,
                        "artist_display_name": song.artist_display_name,
                        "owner_user": song.owner_user,
                        "created_at": (song.created_at.isoformat() if song.created_at else ""),
                        "audio_url": _safe_file_url(song.audio_file),
                        "cover_url": _safe_file_url(song.cover_image),
                        "genre": getattr(song, "genre", "") or "",
                        "editar_url": f"/mi-muro/cancion/{song.id}/editar/",
                        "eliminar_url": f"/mi-muro/eliminar/{song.id}/",
                    },
                    "undo": {"label": undo_label, "url": reverse("revertir")},
                }
            )

        return redirect("mi_muro")

    except ValidationError:
        msg = "Formato no admitido."
        return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")
    except Exception:
        msg = "Error al subir la canción."
        return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")


def _redirect_error(request, msg: str, to_name: str):
    """Redirige con mensaje de error a una vista Django por nombre."""
    messages.error(request, msg)
    return redirect(to_name)


@require_http_methods(["GET", "POST"])
def editar_mi_cancion_en_muro(request, song_id: int):
    """Edita título, intérprete, género y portada de una canción propia del artista."""
    username = _require_session_user(request)
    if not username:
        return redirect("login")
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)

    song = get_object_or_404(Song, id=song_id)
    if song.owner_user != username:
        return HttpResponse("No autorizado", status=403)

    if request.method == "POST":
        new_title = (request.POST.get("title") or "").strip()
        new_artist = (request.POST.get("artist_display_name") or "").strip()
        new_genre = (request.POST.get("genre") or "").strip()
        remove_cov = (request.POST.get("remove_cover") or "") == "1"
        new_cover = request.FILES.get("cover_image")

        if not new_title or not new_artist:
            messages.error(request, "Título e intérprete son obligatorios.")
            return redirect("editar_mi_cancion_en_muro", song_id=song.id)

        try:
            storage = _storage()
            with transaction.atomic():
                # Prevenir duplicados por título del mismo propietario
                if (
                    Song.objects.filter(
                        owner_user=username,
                        visibility="public",
                        title__iexact=new_title,
                    )
                    .exclude(pk=song.id)
                    .exists()
                ):
                    messages.error(request, "Ya tienes otra canción con ese título.")
                    return redirect("editar_mi_cancion_en_muro", song_id=song.id)

                song.title = new_title
                song.artist_display_name = new_artist
                song.genre = new_genre

                if remove_cov:
                    _delete_storage_entry(song.cover_image)
                    song.cover_image = None
                elif new_cover:
                    _delete_storage_entry(song.cover_image)
                    saved = storage.save(
                        f"cover_{username}_{uuid4().hex}{Path(new_cover.name).suffix or ''}",
                        new_cover,
                    )
                    song.cover_image = saved

                song.save(update_fields=["title", "artist_display_name", "cover_image", "genre"])

            messages.success(request, "Cambios guardados.")
            return redirect("mi_muro")
        except Exception:
            messages.error(request, "No se pudieron guardar los cambios.")
            return redirect("editar_mi_cancion_en_muro", song_id=song.id)

    # GET: formulario con contexto
    ctx = {"song": song}
    return render(request, "muro/editar_mi_cancion.html", ctx)


# =============================================================================
# Eliminar + deshacer (muro)
# =============================================================================

@require_http_methods(["POST"])
def eliminar_cancion(request, song_id: int):
    """Marca una canción propia como 'removed' y registra la acción para deshacer."""
    username = _require_session_user(request)
    if not username:
        return redirect("login")
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)

    song = get_object_or_404(Song, id=song_id, owner_user=username)

    if song.visibility == "public":
        song.visibility = "removed"
        song.save(update_fields=["visibility"])

    _put_undo_muro(
        request,
        f"Se eliminó “{song.title}”.",
        {"kind": "restore_song", "song_id": song.id, "owner": username},
    )
    return redirect("mi_muro")


# =============================================================================
# Revertir (genérico para el muro)
# =============================================================================

@require_http_methods(["POST"])
def revertir(request):
    """
    Deshace la última acción del muro.

    Tipos soportados:
      - restore_song: restaura visibilidad a 'public'.
      - delete_song : elimina definitivamente la canción y sus archivos.
    """
    username = _require_session_user(request)
    if not username:
        return redirect("login")
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)

    data = request.session.get("mi_muro_undo")
    if not data:
        return redirect("mi_muro")

    try:
        kind = data.get("kind")
        owner = data.get("owner")
        if owner and owner != username:
            return HttpResponse("No autorizado", status=403)

        if kind in ("restore_song", "delete_song"):
            s = get_object_or_404(Song, id=data.get("song_id"))
            if s.owner_user != username:
                return HttpResponse("No autorizado", status=403)

            if kind == "restore_song":
                if s.visibility != "public":
                    s.visibility = "public"
                    s.save(update_fields=["visibility"])
            else:
                _delete_song_files(s)
                s.delete()
    finally:
        _clear_undo_muro(request)

    return redirect("mi_muro")


# =============================================================================
# Compatibilidad / JSON para reproductor
# =============================================================================

@require_http_methods(["GET", "POST"])
def subir_cancion(request):
    """
    Alias de compatibilidad: en POST delega en `subir_cancion_en_muro`;
    en GET redirige al muro del artista autenticado.
    """
    if request.method == "POST":
        return subir_cancion_en_muro(request)

    username = _require_session_user(request)
    if not username:
        return redirect("login")
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)
    return redirect("mi_muro")


@require_http_methods(["GET"])
def mi_musica_json(request):
    """
    Devuelve en JSON las canciones públicas del artista autenticado (para el reproductor).

    Respuesta:
      {"ok": true, "songs": [{id, title, artist_display_name, audio_url, cover_url, genre}]}
    """
    if "user" not in request.session:
        return JsonResponse({"ok": False, "error": "auth"}, status=401)

    username = request.session.get("user", "")
    qs = Song.objects.filter(owner_user=username, visibility="public").only(
        "id", "title", "artist_display_name", "audio_file", "cover_image", "visibility", "genre"
    )

    songs = []
    for s in qs:
        songs.append(
            {
                "id": s.id,
                "title": s.title,
                "artist_display_name": s.artist_display_name,
                "audio_url": _safe_file_url(s.audio_file),
                "cover_url": _safe_file_url(s.cover_image),
                "genre": getattr(s, "genre", "") or "",
            }
        )
    return JsonResponse({"ok": True, "songs": songs})


# =============================================================================
# Subida masiva
# =============================================================================

_GUID_RE     = re.compile(r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$", re.I)
_HEX_LONG_RE = re.compile(r"[0-9a-f]{16,}", re.I)
_B64ISH_RE   = re.compile(r"^[A-Za-z0-9+/]{24,}={0,2}$")
_WORD_CHARS  = "a-záéíóúñü"
_VOWELS      = "aeiouáéíóú"


def _normalize_base(filename: str) -> str:
    base = os.path.splitext(filename)[0]
    base = re.sub(r"[_\-\.]+", " ", base)
    base = re.sub(r"\s+", " ", base).strip()
    return base


def _clean_title(filename: str) -> str:
    name = os.path.splitext(filename)[0]
    name = re.sub(r"^\s*\d+[)\-._\s]+", "", name)  # quita "01 - ", "1." etc.
    name = name.replace("_", " ").replace("-", " ").strip()
    return name or "Nueva canción"


def _title_candidate_from_filename(filename: str) -> str:
    raw = _clean_title(filename)
    return _normalize_base(raw)


def _looks_random(name: str) -> bool:
    if _GUID_RE.fullmatch(name):
        return True
    if _HEX_LONG_RE.search(name):
        return True
    if _B64ISH_RE.fullmatch(name):
        return True
    return False


def _title_is_sensible(title: str) -> tuple[bool, str]:
    """
    Devuelve (ok, motivo_si_rechazo). Heurístico y en español.
    """
    if not STRICT_TITLE_FILTER:
        return True, ""

    if len(title) < 3:
        return False, "muy corto"

    compact = re.sub(r"\s+", "", title)
    letters = re.findall(rf"[{_WORD_CHARS}]", title, flags=re.I)
    digits  = re.findall(r"\d", title)
    vowels  = re.findall(rf"[{_VOWELS}]", title, flags=re.I)

    letter_ratio = len(letters) / max(1, len(compact))
    digit_ratio  = len(digits)  / max(1, len(compact))

    if _looks_random(title):
        return False, "parece un identificador (hash/UUID/base64)"

    if len(letters) >= 5 and len(vowels) == 0:
        return False, "sin vocales (parece código aleatorio)"

    if letter_ratio < 0.5 and digit_ratio > 0.3:
        return False, "demasiados números/símbolos"

    tokens = title.split()
    long_words = [t for t in tokens if re.fullmatch(rf"[{_WORD_CHARS}]{{3,}}", t, flags=re.I)]
    if not long_words:
        return False, "no contiene palabras reconocibles"

    if len(title) > 120:
        return False, "demasiado largo"

    return True, ""


def _sha256_file(django_file) -> str:
    h = sha256()
    for chunk in django_file.chunks():
        h.update(chunk)
    try:
        django_file.seek(0)
    except Exception:
        pass
    return h.hexdigest()


@require_http_methods(["GET", "POST"])
def subida_masiva(request):
    # === Requiere sesión y rol artista ===
    username = _require_session_user(request)
    if not username:
        return redirect("login")
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)

    if request.method == "GET":
        return render(request, "muro/subida_masiva.html", {
            "MAX_FILES": _MAX_FILES,
            "MAX_MB": int(_MAX_FILE_SIZE/1024/1024),
        })

    # POST (fetch desde el template)
    files = request.FILES.getlist("audio_files")
    default_genre = (request.POST.get("genre") or "").strip()
    genre_other   = (request.POST.get("genre_other") or "").strip()
    cover_file    = request.FILES.get("cover_image")  # opcional 1 para todo el lote

    if not files:
        return HttpResponseBadRequest("No se enviaron archivos.")
    if len(files) > _MAX_FILES:
        return HttpResponseBadRequest(f"Máximo permitido: {_MAX_FILES} archivos.")

    genre = genre_other if default_genre == "_other" else default_genre
    if not genre:
        return HttpResponseBadRequest("Género obligatorio.")

    storage = _storage()

    # Si viene una portada única, lee bytes una sola vez y reutiliza
    cover_bytes = None
    cover_suffix = ""
    if cover_file:
        try:
            cover_bytes = cover_file.read()
            try:
                cover_file.seek(0)
            except Exception:
                pass
            cover_suffix = Path(cover_file.name).suffix or ".jpg"
        except Exception:
            cover_bytes = None
            cover_suffix = ""

    results = []
    for f in files:
        ext = (Path(f.name).suffix.lower().lstrip(".") or "")
        if ext not in _ALLOWED_EXTS:
            results.append({"name": f.name, "ok": False, "error": "Extensión no permitida"})
            continue

        if getattr(f, "size", 0) > _MAX_FILE_SIZE:
            results.append({"name": f.name, "ok": False, "error": f"Archivo excede {int(_MAX_FILE_SIZE/1024/1024)} MB"})
            continue

        # --- Título heurístico: descartamos nombres no lógicos ---
        candidate = _title_candidate_from_filename(f.name)
        ok_title, why = _title_is_sensible(candidate)
        if not ok_title:
            results.append({
                "name": f.name,
                "ok": False,
                "error": f"Nombre no válido para subida rápida ({why}). Renómbralo e inténtalo de nuevo."
            })
            continue

        # Hash para evitar duplicados exactos
        try:
            sha = _sha256_file(f)
        except Exception:
            results.append({"name": f.name, "ok": False, "error": "No se pudo leer el archivo"})
            continue

        if Song.objects.filter(owner_user=username, audio_sha256=sha, visibility="public").exists():
            results.append({"name": f.name, "ok": False, "error": "Duplicado (mismo audio)"})
            continue

        title = candidate

        # Evita duplicados por título
        if Song.objects.filter(owner_user=username, visibility="public", title__iexact=title).exists():
            results.append({"name": f.name, "ok": False, "error": "Duplicado (mismo título)"})
            continue

        try:
            with transaction.atomic():
                audio_path = storage.save(f"uploaded_songs/audio_{username}_{sha[:12]}.{ext}", f)

                cover_path = None
                if cover_bytes:
                    # Clona la misma portada para cada canción con nombre único
                    cf_name = f"uploaded_covers/cover_{username}_{sha[:12]}{cover_suffix or '.jpg'}"
                    cover_path = storage.save(cf_name, ContentFile(cover_bytes))

                s = Song.objects.create(
                    title=title,
                    artist_display_name=username,  # o tu display_name si prefieres
                    genre=genre,
                    owner_user=username,
                    audio_file=audio_path,
                    cover_image=cover_path,
                    audio_sha256=sha,
                    visibility="public",
                )

            audio_url = _safe_file_url(s.audio_file)
            cover_url = _safe_file_url(s.cover_image)

            results.append({
                "name": f.name, "ok": True, "song": {
                    "id": s.id,
                    "title": s.title,
                    "artist_display_name": s.artist_display_name,
                    "genre": s.genre,
                    "audio_url": audio_url,
                    "cover_url": cover_url,
                    "created_at": s.created_at.isoformat(timespec="minutes") if s.created_at else "",
                }
            })

        except Exception as e:
            results.append({"name": f.name, "ok": False, "error": f"Error al guardar: {e}"})

    # ¿Respuesta JSON (fetch)?
    if (request.headers.get("X-Requested-With") or "").lower() == "fetch":
        ok_any = any(r.get("ok") for r in results)
        return JsonResponse({"ok": ok_any, "results": results})

    # Fallback: redirección con resumen
    creadas = sum(1 for r in results if r.get("ok"))
    omitidas = len(results) - creadas
    messages.info(request, f"Subida masiva: {creadas} creadas, {omitidas} omitidas.")
    return redirect("muro_subida_masiva")

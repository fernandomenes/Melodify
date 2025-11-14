# muro/views_artist.py
"""
Vistas del muro de artista: sección pública/propia y gestión de canciones (CRUD).
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
from django.http import (
    HttpResponse,
    HttpResponseBadRequest,
    JsonResponse,
)
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_http_methods

from inicio_sesion import base as base
from inicio_sesion.auth_helpers import _get_user_role, _is_artist, _require_session_user
from inicio_sesion.models import ArtistProfile, Song, Users

# =============================================================================
# Configuración / constantes
# =============================================================================

_MAX_FILES = 30
_MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB
_ALLOWED_EXTS = {"mp3", "wav", "ogg", "m4a", "flac"}
STRICT_TITLE_FILTER = True

# =============================================================================
# Helpers generales
# =============================================================================


def _is_fetch(request) -> bool:
    return (request.headers.get("X-Requested-With") or "").lower() == "fetch"


def _redirect_login_clean(request):
    for _ in messages.get_messages(request):
        pass
    return redirect("login")


def _storage():
    return getattr(base, "_AUDIO_STORAGE", default_storage)


def _safe_file_url(field) -> str:
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


def _delete_storage_entry(file_or_url) -> None:
    try:
        storage = _storage()
        name = getattr(file_or_url, "name", "") or str(file_or_url) or ""
        base_url = getattr(storage, "base_url", "") or ""
        if base_url:
            prefix = base_url.rstrip("/") + "/"
            if name.startswith(prefix):
                name = name[len(prefix):].lstrip("/")
        if name:
            storage.delete(name)
    except Exception:
        pass


def _delete_song_files(song: Song) -> None:
    storage = _storage()
    try:
        name = getattr(song.audio_file, "name", "") or ""
        if name:
            storage.delete(name)
    except Exception:
        pass
    try:
        if getattr(song, "cover_image", None):
            cname = getattr(song.cover_image, "name", "") or ""
            if cname:
                storage.delete(cname)
    except Exception:
        pass


def _get_artist_profile_by_username(username: str) -> Optional[ArtistProfile]:
    try:
        user = Users.objects.get(user=username)
        return user.artist_profile
    except (Users.DoesNotExist, ArtistProfile.DoesNotExist):
        return None


# =============================================================================
# Heurísticas de título / hash
# =============================================================================

_GUID_RE = re.compile(r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$", re.I)
_HEX_LONG_RE = re.compile(r"[0-9a-f]{16,}", re.I)
_B64ISH_RE = re.compile(r"^[A-Za-z0-9+/]{24,}={0,2}$")
_WORD_CHARS = "a-záéíóúñü"
_VOWELS = "aeiouáéíóú"


def _normalize_base(filename: str) -> str:
    base = os.path.splitext(filename)[0]
    base = re.sub(r"[_\-\.]+", " ", base)
    base = re.sub(r"\s+", " ", base).strip()
    return base


def _clean_title(filename: str) -> str:
    name = os.path.splitext(filename)[0]
    name = re.sub(r"^\s*\d+[)\-._\s]+", "", name)
    name = name.replace("_", " ").replace("-", " ").strip()
    return name or "Nueva canción"


def _title_candidate_from_filename(filename: str) -> str:
    return _normalize_base(_clean_title(filename))


def _looks_random(name: str) -> bool:
    if _GUID_RE.fullmatch(name):
        return True
    if _HEX_LONG_RE.search(name):
        return True
    if _B64ISH_RE.fullmatch(name):
        return True
    return False


def _title_is_sensible(title: str) -> tuple[bool, str]:
    if not STRICT_TITLE_FILTER:
        return True, ""
    if len(title) < 3:
        return False, "muy corto"
    compact = re.sub(r"\s+", "", title)
    letters = re.findall(rf"[{_WORD_CHARS}]", title, flags=re.I)
    digits = re.findall(r"\d", title)
    vowels = re.findall(rf"[{_VOWELS}]", title, flags=re.I)
    letter_ratio = len(letters) / max(1, len(compact))
    digit_ratio = len(digits) / max(1, len(compact))
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


# =============================================================================
# Vistas del muro (público/propio)
# =============================================================================


@require_http_methods(["GET"])
def muro_publico(request, username: str):
    artist_user = get_object_or_404(Users, user=username, type__iexact="artista")
    try:
        prof = artist_user.artist_profile
        wall_description = (prof.description or "").strip()
    except ArtistProfile.DoesNotExist:
        wall_description = ""

    songs = Song.objects.filter(owner_user=username, visibility="public").only(
        "id",
        "title",
        "artist_display_name",
        "created_at",
        "cover_image",
        "audio_file",
        "genre",
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

    # Playlist "Mi música" para el propietario (integración con reproductor)
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

    undo_muro_data = request.session.get("mi_muro_undo")
    if undo_muro_data and undo_muro_data.get("owner") != session_user:
        undo_muro_data = None
    undo_muro_label = request.session.get("mi_muro_undo_label") if undo_muro_data else None

    ctx = {
        "artist": artist_user,
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
    username = _require_session_user(request)
    if not username:
        return _redirect_login_clean(request)
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)
    return muro_publico(request, username)


# =============================================================================
# Canciones (subir/editar/eliminar/undo + JSON)
# =============================================================================


@require_http_methods(["POST"])
def subir_cancion_en_muro(request):
    """
    Subida de canción desde el muro del artista.

    El campo artist_display_name ya no proviene del formulario: se fija siempre
    al nombre de usuario autenticado (username), para garantizar consistencia
    con el artista propietario.
    """
    username = _require_session_user(request)
    if not username:
        return _redirect_login_clean(request)
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)
    is_fetch = _is_fetch(request)

    def _json_err(msg, status=400):
        return JsonResponse({"ok": False, "error": msg}, status=status)

    title = (request.POST.get("title") or "").strip()
    genre = (request.POST.get("genre") or "").strip()
    audio = request.FILES.get("audio_file")
    cover = request.FILES.get("cover_image")

    # El autor principal SIEMPRE será el usuario logueado
    artist_display_name = username

    # ======================= Validación de título =======================
    if not title:
        if audio:
            candidate = _title_candidate_from_filename(audio.name)
            ok_title, why = _title_is_sensible(candidate)
            if ok_title:
                title = candidate
            else:
                msg = f"Título inválido ({why})."
                return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")
        else:
            msg = "Título requerido"
            return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")
    else:
        ok_title, why = _title_is_sensible(title)
        if not ok_title:
            msg = f"Título no válido ({why})."
            return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")

    # ======================= Audio obligatorio ==========================
    if audio is None:
        msg = "El archivo de audio es obligatorio."
        return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")

    # ======================= Duplicados / límites =======================
    if Song.objects.filter(owner_user=username, visibility="public", title__iexact=title).exists():
        msg = "Ya tienes una canción con ese título."
        return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")

    if getattr(audio, "size", 0) > _MAX_FILE_SIZE:
        msg = f"El archivo excede {int(_MAX_FILE_SIZE/1024/1024)} MB."
        return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")

    audio_digest = _sha256_file(audio)
    if audio_digest and Song.objects.filter(
        owner_user=username, visibility="public", audio_sha256=audio_digest
    ).exists():
        msg = "Ya subiste este mismo audio antes."
        return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")

    storage = _storage()
    try:
        audio_ext = Path(audio.name).suffix or ""
        audio_name = f"uploaded_songs/audio_{username}_{uuid4().hex}{audio_ext}"

        cover_name = None
        if cover:
            cover_ext = Path(cover.name).suffix or ""
            cover_name = f"uploaded_covers/cover_{username}_{uuid4().hex}{cover_ext}"

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
                    "undo": {"label": undo_label, "url": "revertir_mi_cancion"},
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
    if not _is_fetch(request):
        messages.error(request, msg)
    return redirect(to_name)


def _put_undo_muro(request, label: str, data: dict) -> None:
    request.session["mi_muro_undo"] = data
    request.session["mi_muro_undo_label"] = label
    request.session.modified = True


def _clear_undo_muro(request) -> None:
    request.session.pop("mi_muro_undo", None)
    request.session.pop("mi_muro_undo_label", None)
    request.session.modified = True


@require_http_methods(["GET", "POST"])
def editar_mi_cancion_en_muro(request, song_id: int):
    """
    Edición de una canción desde el muro del artista.

    El artist_display_name ya no se edita aquí: queda fijado al valor existente
    (normalmente el username del dueño). Solo se permite cambiar título, género
    y portada.
    """
    username = _require_session_user(request)
    if not username:
        return _redirect_login_clean(request)
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)

    song = get_object_or_404(Song, id=song_id)
    if song.owner_user != username:
        return HttpResponse("No autorizado", status=403)

    if request.method == "POST":
        new_title = (request.POST.get("title") or "").strip()
        new_genre = (request.POST.get("genre") or "").strip()
        remove_cov = (request.POST.get("remove_cover") or "") == "1"
        new_cover = request.FILES.get("cover_image")

        # Ahora solo el título es obligatorio; el autor no se edita aquí
        if not new_title:
            if not _is_fetch(request):
                messages.error(request, "El título es obligatorio.")
            return redirect("editar_mi_cancion_en_muro", song_id=song.id)

        try:
            storage = _storage()
            with transaction.atomic():
                if (
                    Song.objects.filter(
                        owner_user=username,
                        visibility="public",
                        title__iexact=new_title,
                    )
                    .exclude(pk=song.id)
                    .exists()
                ):
                    if not _is_fetch(request):
                        messages.error(request, "Ya tienes otra canción con ese título.")
                    return redirect("editar_mi_cancion_en_muro", song_id=song.id)

                # Actualizamos título y género; el autor se mantiene igual
                song.title = new_title
                song.genre = new_genre

                if remove_cov:
                    _delete_storage_entry(song.cover_image)
                    song.cover_image = None
                elif new_cover:
                    _delete_storage_entry(song.cover_image)
                    saved = storage.save(
                        f"uploaded_covers/cover_{username}_{uuid4().hex}{Path(new_cover.name).suffix or ''}",
                        new_cover,
                    )
                    song.cover_image = saved

                # Ya no incluimos artist_display_name en update_fields
                song.save(update_fields=["title", "cover_image", "genre"])

            if not _is_fetch(request):
                messages.success(request, "Cambios guardados.")
            return redirect("mi_muro")
        except Exception:
            if not _is_fetch(request):
                messages.error(request, "No se pudieron guardar los cambios.")
            return redirect("editar_mi_cancion_en_muro", song_id=song.id)

    return render(request, "muro/editar_mi_cancion.html", {"song": song})


@require_http_methods(["POST"])
def eliminar_cancion(request, song_id: int):
    username = _require_session_user(request)
    if not username:
        return _redirect_login_clean(request)
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
    if _is_fetch(request):
        return JsonResponse({"ok": True, "undo_label": f"Se eliminó “{song.title}”."})
    return redirect("mi_muro")


@require_http_methods(["POST"])
def revertir_mi_cancion(request):
    username = _require_session_user(request)
    if not username:
        return _redirect_login_clean(request)
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

    if _is_fetch(request):
        return HttpResponse(status=204)
    return redirect("mi_muro")


@require_http_methods(["GET", "POST"])
def subir_cancion(request):
    if request.method == "POST":
        return subir_cancion_en_muro(request)
    username = _require_session_user(request)
    if not username:
        return _redirect_login_clean(request)
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)
    return redirect("mi_muro")


@require_http_methods(["GET"])
def mi_musica_json(request):
    if "user" not in request.session:
        return JsonResponse({"ok": False, "error": "auth"}, status=401)

    username = request.session.get("user", "")
    qs = Song.objects.filter(owner_user=username, visibility="public").only(
        "id", "title", "artist_display_name", "audio_file", "cover_image", "visibility", "genre"
    )
    songs = [
        {
            "id": s.id,
            "title": s.title,
            "artist_display_name": s.artist_display_name,
            "audio_url": _safe_file_url(s.audio_file),
            "cover_url": _safe_file_url(s.cover_image),
            "genre": getattr(s, "genre", "") or "",
        }
        for s in qs
    ]
    return JsonResponse({"ok": True, "songs": songs})


# =============================================================================
# Subida masiva
# =============================================================================


@require_http_methods(["GET", "POST"])
def subida_masiva(request):
    username = _require_session_user(request)
    if not username:
        return _redirect_login_clean(request)
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)

    if request.method == "GET":
        return render(
            request,
            "muro/subida_masiva.html",
            {"MAX_FILES": _MAX_FILES, "MAX_MB": int(_MAX_FILE_SIZE / 1024 / 1024)},
        )

    files = request.FILES.getlist("audio_files")
    default_genre = (request.POST.get("genre") or "").strip()
    genre_other = (request.POST.get("genre_other") or "").strip()
    cover_file = request.FILES.get("cover_image")

    if not files:
        return HttpResponseBadRequest("No se enviaron archivos.")
    if len(files) > _MAX_FILES:
        return HttpResponseBadRequest(f"Máximo permitido: {_MAX_FILES} archivos.")

    genre = genre_other if default_genre == "_other" else default_genre
    if not genre:
        return HttpResponseBadRequest("Género obligatorio.")

    storage = _storage()

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
            results.append(
                {
                    "name": f.name,
                    "ok": False,
                    "error": f"Archivo excede {int(_MAX_FILE_SIZE/1024/1024)} MB",
                }
            )
            continue

        candidate = _title_candidate_from_filename(f.name)
        ok_title, why = _title_is_sensible(candidate)
        if not ok_title:
            results.append(
                {
                    "name": f.name,
                    "ok": False,
                    "error": f"Nombre no válido para subida rápida ({why}).",
                }
            )
            continue

        try:
            sha = _sha256_file(f)
        except Exception:
            results.append({"name": f.name, "ok": False, "error": "No se pudo leer el archivo"})
            continue

        if Song.objects.filter(owner_user=username, audio_sha256=sha, visibility="public").exists():
            results.append({"name": f.name, "ok": False, "error": "Duplicado (mismo audio)"})
            continue

        title = candidate
        if Song.objects.filter(owner_user=username, visibility="public", title__iexact=title).exists():
            results.append({"name": f.name, "ok": False, "error": "Duplicado (mismo título)"})
            continue

        try:
            with transaction.atomic():
                audio_path = storage.save(f"uploaded_songs/audio_{username}_{sha[:12]}.{ext}", f)
                cover_path = None
                if cover_bytes:
                    cf_name = f"uploaded_covers/cover_{username}_{sha[:12]}{cover_suffix or '.jpg'}"
                    cover_path = storage.save(cf_name, ContentFile(cover_bytes))

                s = Song.objects.create(
                    title=title,
                    artist_display_name=username,
                    genre=genre,
                    owner_user=username,
                    audio_file=audio_path,
                    cover_image=cover_path,
                    audio_sha256=sha,
                    visibility="public",
                )

            audio_url = _safe_file_url(s.audio_file)
            cover_url = _safe_file_url(s.cover_image)
            results.append(
                {
                    "name": f.name,
                    "ok": True,
                    "song": {
                        "id": s.id,
                        "title": s.title,
                        "artist_display_name": s.artist_display_name,
                        "genre": s.genre,
                        "audio_url": audio_url,
                        "cover_url": cover_url,
                        "created_at": s.created_at.isoformat(timespec="minutes")
                        if s.created_at
                        else "",
                    },
                }
            )
        except Exception as e:
            results.append({"name": f.name, "ok": False, "error": f"Error al guardar: {e}"})

    if _is_fetch(request):
        ok_any = any(r.get("ok") for r in results)
        return JsonResponse({"ok": ok_any, "results": results})

    creadas = sum(1 for r in results if r.get("ok"))
    omitidas = len(results) - creadas
    messages.info(request, f"Subida masiva: {creadas} creadas, {omitidas} omitidas.")
    return redirect("muro_subida_masiva")


# =============================================================================
# Fragmento de playlists (UI)
# =============================================================================


@require_http_methods(["GET"])
def playlists_fragment(request):
    html = '<div class="card" style="margin:0"><p class="muted">Playlists del artista (próximamente).</p></div>'
    return HttpResponse(html)

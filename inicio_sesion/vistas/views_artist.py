# inicio_sesion/vistas/views_artist.py
"""Vistas del muro del artista: pública, propia, CRUD de canciones y deshacer."""

import json
from hashlib import sha256
from pathlib import Path
from typing import Optional
from uuid import uuid4

from django.contrib import messages
from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_http_methods

from .. import base as base
from ..auth_helpers import _get_user_role, _is_artist, _require_session_user
from ..models import ArtistProfile, Song, Users

# ================= Helpers de storage/archivos =================


def _storage():
    """Devuelve el storage usado para audio/portadas."""
    return base._AUDIO_STORAGE


def _rel_from_storage_url(url: str) -> Optional[str]:
    """Convierte una URL servida por el storage a su ruta relativa almacenada."""
    if not url:
        return None
    url = str(url)
    base_url = _storage().base_url.rstrip("/") + "/"
    if url.startswith(base_url):
        return url[len(base_url) :].lstrip("/")
    return None


def _delete_stored_file_by_url(url: str) -> None:
    """Elimina del storage el archivo apuntado por una URL del propio storage."""
    rel = _rel_from_storage_url(url or "")
    if rel:
        try:
            _storage().delete(rel)
        except Exception:
            pass


def _delete_storage_entry(file_or_url) -> None:
    """Elimina del storage a partir de FieldFile.name o desde URL del storage."""
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
        name = getattr(song.audio_file, "name", "") or _rel_from_storage_url(
            str(song.audio_file) or ""
        )
        if name:
            storage.delete(name)
    except Exception:
        pass
    try:
        if getattr(song, "cover_image", None):
            cname = getattr(song.cover_image, "name", "") or _rel_from_storage_url(
                str(song.cover_image) or ""
            )
            if cname:
                storage.delete(cname)
    except Exception:
        pass


# =============== Helpers de UNDO en el muro ====================


def _put_undo_muro(request, label: str, data: dict):
    """Guarda en sesión el último cambio del muro para permitir revertirlo."""
    request.session["mi_muro_undo"] = data
    request.session["mi_muro_undo_label"] = label
    request.session.modified = True


def _clear_undo_muro(request):
    """Limpia el estado de deshacer del muro."""
    request.session.pop("mi_muro_undo", None)
    request.session.pop("mi_muro_undo_label", None)
    request.session.modified = True


# ====================== Vistas de muro =========================


@require_http_methods(["GET"])
def muro_publico(request, username: str):
    """Renderiza el muro público de un artista (canciones visibles y descripción)."""
    artist = get_object_or_404(Users, user=username, type__iexact="artista")
    try:
        prof = artist.artist_profile
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
                try:
                    session_avatar_url = u.avatar.url
                except Exception:
                    session_avatar_url = str(u.avatar)
            if getattr(u, "created_at", None):
                session_created_at = u.created_at.strftime("%Y-%m-%d %H:%M")
            if role_lower == "artista":
                try:
                    session_artist_desc = (u.artist_profile.description or "").strip()
                except ArtistProfile.DoesNotExist:
                    session_artist_desc = ""
        except Users.DoesNotExist:
            pass

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
                "audioUrl": (s.audio_file.url if getattr(s, "audio_file", None) else ""),
                "coverUrl": (s.cover_image.url if getattr(s, "cover_image", None) else None),
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
    return render(request, "inicio_sesion/muro_artista.html", ctx)


@require_http_methods(["GET"])
def mi_muro(request):
    """Redirige al muro del artista autenticado; requiere rol de artista."""
    username = _require_session_user(request)
    if not username:
        return redirect("login")
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)
    return muro_publico(request, username)


# ================= Acciones de canciones (propias) ==============


@require_http_methods(["POST"])
def subir_cancion_en_muro(request):
    """
    Sube una nueva canción al muro del artista autenticado.
    Valida duplicados por título y por hash del audio. Límite de 10 MB.
    """
    username = _require_session_user(request)
    if not username:
        return redirect("login")
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)

    is_fetch = (request.headers.get("x-requested-with", "") or "").lower() == "fetch"

    def _json_err(msg, status=400):
        return JsonResponse({"ok": False, "error": msg}, status=status)

    title = (request.POST.get("title") or "").strip()
    artist_display_name = (request.POST.get("artist_display_name") or "").strip()
    genre = (request.POST.get("genre") or "").strip()
    audio = request.FILES.get("audio_file")
    cover = request.FILES.get("cover_image")

    if not title or not artist_display_name or audio is None:
        msg = "Título, intérprete y archivo de audio son obligatorios."
        return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")

    if Song.objects.filter(owner_user=username, visibility="public", title__iexact=title).exists():
        msg = "Ya tienes una canción con ese título."
        return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")

    if getattr(audio, "size", 0) > 10 * 1024 * 1024:
        msg = "El archivo excede 10 MB."
        return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")

    hasher = sha256()
    for chunk in audio.chunks():
        hasher.update(chunk)
    audio_digest = hasher.hexdigest()
    try:
        audio.seek(0)
    except Exception:
        pass

    if (
        audio_digest
        and Song.objects.filter(
            owner_user=username, visibility="public", audio_sha256=audio_digest
        ).exists()
    ):
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
                        "audio_url": song.audio_file.url if song.audio_file else "",
                        "cover_url": song.cover_image.url if song.cover_image else "",
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
    """Redirecciona con mensaje de error a una vista Django por nombre."""
    messages.error(request, msg)
    return redirect(to_name)


@require_http_methods(["GET", "POST"])
def editar_mi_cancion_en_muro(request, song_id: int):
    """Edita título, intérprete, género y portada de una canción propia."""
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

                song.save(
                    update_fields=[
                        "title",
                        "artist_display_name",
                        "cover_image",
                        "genre",
                    ]
                )

            messages.success(request, "Cambios guardados.")
            return redirect("mi_muro")
        except Exception:
            messages.error(request, "No se pudieron guardar los cambios.")
            return redirect("editar_mi_cancion_en_muro", song_id=song.id)

    return render(request, "inicio_sesion/editar_mi_cancion.html", {"song": song})


# =============== Eliminar + Deshacer (muro) =====================


@require_http_methods(["POST"])
def eliminar_cancion(request, song_id: int):
    """Marca una canción propia como 'removed' y registra undo en sesión."""
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


# ====================== Revertir (genérico) =====================


@require_http_methods(["POST"])
def revertir(request):
    """
    Deshace la última acción del muro.

    Acciones soportadas:
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


# ============= Alias de compatibilidad para tests ===============


@require_http_methods(["GET", "POST"])
def subir_cancion(request):
    """Alias de compatibilidad: delega en subir_cancion_en_muro y redirige al muro."""
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
    if "user" not in request.session:
        return JsonResponse({"ok": False, "error": "auth"}, status=401)
    username = request.session.get("user", "")
    qs = Song.objects.filter(owner_user=username, visibility="public").only(
        "id",
        "title",
        "artist_display_name",
        "audio_file",
        "cover_image",
        "visibility",
        "genre",
    )

    songs = []
    for s in qs:
        try:
            audio = s.audio_file.url
        except Exception:
            audio = str(s.audio_file)
        try:
            cover = s.cover_image.url
        except Exception:
            cover = str(s.cover_image) if s.cover_image else ""
        songs.append(
            {
                "id": s.id,
                "title": s.title,
                "artist_display_name": s.artist_display_name,
                "audio_url": audio,
                "cover_url": cover,
                "genre": getattr(s, "genre", "") or "",
            }
        )
    return JsonResponse({"ok": True, "songs": songs})

# inicio_sesion/vistas/views_music.py
"""Vistas de administración/propietario para listar, editar y eliminar canciones con soporte de deshacer."""

from pathlib import Path
from uuid import uuid4

from django.contrib import messages
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_http_methods

from .. import base as base
from ..auth_helpers import _get_user_role, _is_admin, _is_artist, _require_session_user
from ..models import Song


def _storage():
    return base._AUDIO_STORAGE


def _put_song_undo(request, label: str, data: dict):
    request.session["song_undo"] = data
    request.session["song_undo_label"] = label
    request.session.modified = True


def _clear_song_undo(request):
    request.session.pop("song_undo", None)
    request.session.pop("song_undo_label", None)
    request.session.modified = True


def _put_song_undo_artist(request, label: str, data: dict):
    request.session["song_undo_artist"] = data
    request.session["song_undo_artist_label"] = label
    request.session.modified = True


def _clear_song_undo_artist(request):
    request.session.pop("song_undo_artist", None)
    request.session.pop("song_undo_artist_label", None)
    request.session.modified = True


def _delete_storage_entry(file_or_url) -> None:
    try:
        name = getattr(file_or_url, "name", "") or str(file_or_url) or ""
        base_url = _storage().base_url.rstrip("/") + "/"
        if name.startswith(base_url):
            name = name[len(base_url) :].lstrip("/")
        if name:
            _storage().delete(name)
    except Exception:
        pass


@require_http_methods(["GET"])
def musica(request):
    username = _require_session_user(request)
    if not username:
        return redirect("login")
    role = _get_user_role(username)
    if not _is_admin(role):
        return HttpResponse("No autorizado", status=403)

    songs = Song.objects.filter(visibility="public").only(
        "id",
        "title",
        "artist_display_name",
        "owner_user",
        "created_at",
        "cover_image",
        "genre",
    )
    song_undo = request.session.get("song_undo")
    song_undo_label = request.session.get("song_undo_label")

    return render(
        request,
        "inicio_sesion/musica.html",
        {"songs": songs, "song_undo": song_undo, "song_undo_label": song_undo_label},
    )


@require_http_methods(["GET", "POST"])
def editar_cancion(request, song_id: int):
    username = _require_session_user(request)
    if not username:
        return redirect("login")
    role = _get_user_role(username)
    if not _is_admin(role):
        return HttpResponse("No autorizado", status=403)

    song = get_object_or_404(Song, id=song_id)

    if request.method == "POST":
        new_title = (request.POST.get("title") or "").strip()
        new_artist = (request.POST.get("artist_display_name") or "").strip()
        new_genre = (request.POST.get("genre") or "").strip()
        remove_cov = (request.POST.get("remove_cover") or "") == "1"
        new_cover = request.FILES.get("cover_image")

        if not new_title:
            messages.error(request, "El título no puede estar vacío.")
            return redirect("editar_cancion", song_id=song.id)
        if not new_artist:
            messages.error(request, "El intérprete no puede estar vacío.")
            return redirect("editar_cancion", song_id=song.id)

        try:
            with transaction.atomic():
                if (
                    Song.objects.filter(
                        owner_user=song.owner_user,
                        visibility="public",
                        title__iexact=new_title,
                    )
                    .exclude(pk=song.id)
                    .exists()
                ):
                    messages.error(
                        request,
                        "Ya existe otra canción de este propietario con ese título.",
                    )
                    return redirect("editar_cancion", song_id=song.id)

                song.title = new_title
                song.artist_display_name = new_artist
                song.genre = new_genre

                if remove_cov:
                    _delete_storage_entry(song.cover_image)
                    song.cover_image = None
                elif new_cover:
                    _delete_storage_entry(song.cover_image)
                    name = f"cover_{song.owner_user}_{uuid4().hex}{Path(new_cover.name).suffix or ''}"
                    saved = _storage().save(name, new_cover)
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
            return redirect("gestion")
        except Exception:
            messages.error(request, "No se pudieron guardar los cambios.")
            return redirect("editar_cancion", song_id=song.id)

    return render(request, "inicio_sesion/editar_cancion.html", {"song": song})


@require_http_methods(["POST"])
def eliminar_cancion(request, song_id: int):
    username = _require_session_user(request)
    if not username:
        return redirect("login")

    role = _get_user_role(username)
    song = get_object_or_404(Song, id=song_id)
    owns = song.owner_user == username
    is_admin = _is_admin(role)

    if not (owns or is_admin):
        return HttpResponse("No autorizado", status=403)

    try:
        with transaction.atomic():
            prev_visibility = song.visibility
            song.visibility = "removed"
            song.save(update_fields=["visibility"])
            messages.success(request, "Canción eliminada.")

            if is_admin:
                request.session["gestion_undo"] = {
                    "kind": "restore_song_visibility",
                    "song_id": song.id,
                    "prev_visibility": prev_visibility,
                }
                request.session["gestion_undo_label"] = (
                    f"Se eliminó “{song.title}” de {song.artist_display_name}."
                )
                request.session.modified = True
            else:
                _put_song_undo_artist(
                    request,
                    f"Eliminaste “{song.title}”.",
                    {
                        "kind": "restore_song_visibility_artist",
                        "song_id": song.id,
                        "prev_visibility": prev_visibility,
                        "owner_user": username,
                    },
                )
    except Exception:
        messages.error(request, "Error al eliminar la canción.")

    return redirect("gestion" if is_admin else "mi_muro")


@require_http_methods(["POST"])
def revertir_cancion(request):
    username = _require_session_user(request)
    if not username:
        return redirect("login")
    role = _get_user_role(username)
    if not _is_admin(role):
        return HttpResponse("No autorizado", status=403)

    data = request.session.get("song_undo")
    if not data or data.get("kind") != "restore_song_visibility":
        messages.info(request, "No hay ninguna eliminación para deshacer.")
        return redirect("gestion")

    song_id = data.get("song_id")
    prev_visibility = data.get("prev_visibility", "public")

    try:
        with transaction.atomic():
            song = get_object_or_404(Song, id=song_id)
            song.visibility = prev_visibility
            song.save(update_fields=["visibility"])
            messages.success(request, f"Se restauró la canción “{song.title}”.")
            _clear_song_undo(request)
    except Exception:
        messages.error(request, "No fue posible deshacer la eliminación.")

    return redirect("gestion")


@require_http_methods(["POST"])
def revertir_mi_cancion(request):
    username = _require_session_user(request)
    if not username:
        return redirect("login")
    role = _get_user_role(username)
    if not _is_artist(role):
        return HttpResponse("No autorizado", status=403)

    data = request.session.get("song_undo_artist")
    if not data or data.get("kind") != "restore_song_visibility_artist":
        messages.info(request, "No hay ninguna eliminación para deshacer.")
        return redirect("mi_muro")

    song_id = data.get("song_id")
    prev_visibility = data.get("prev_visibility", "public")
    owner_user = data.get("owner_user")

    try:
        with transaction.atomic():
            song = get_object_or_404(Song, id=song_id)
            if song.owner_user != username or owner_user != username:
                return HttpResponse("No autorizado", status=403)
            song.visibility = prev_visibility
            song.save(update_fields=["visibility"])
            messages.success(request, f"Se restauró tu canción “{song.title}”.")
            _clear_song_undo_artist(request)
    except Exception:
        messages.error(request, "No fue posible deshacer la eliminación.")

    return redirect("mi_muro")

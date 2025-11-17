# gestion/views_music.py
"""
Vistas de administración de canciones: edición, eliminación (simple y múltiple)
y operaciones de deshacer para administradores y artistas.

Incluye:
- Manejo de permisos para administradores y artistas.
- Soporte para navegación clásica (redirect + mensajes) y peticiones fetch (JSON/204).
- Registro de acciones de deshacer en sesión (gestion_undo, song_undo_artist).
"""

from pathlib import Path
from uuid import uuid4

from django.contrib import messages
from django.contrib import messages as _msgs
from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.http import JsonResponse, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.template.loader import render_to_string
from django.views.decorators.http import require_http_methods

from inicio_sesion import base as base
from inicio_sesion.auth_helpers import (
    _require_session_user,
    _get_user_role,
    _is_admin,
    _is_artist,
)
from inicio_sesion.models import Song, Users, LikeMedia


# ---------------------------------------------------------------------------
# Helpers internos (storage, likes, HTML, undo y request)
# ---------------------------------------------------------------------------

def _storage():
  """Devuelve el storage configurado para archivos de audio y portadas."""
  return base._AUDIO_STORAGE


def _attach_is_liked(request, songs):
  """
  Añade el atributo booleano `is_liked` a cada canción para el usuario
  autenticado en la sesión.
  """
  songs = list(songs)

  for s in songs:
    s.is_liked = False

  if not songs:
    return songs

  username = request.session.get("user")
  if not username:
    return songs

  try:
    u = Users.objects.get(user=username)
  except Users.DoesNotExist:
    return songs

  ct_song = ContentType.objects.get_for_model(Song)

  liked_ids = set(
    LikeMedia.objects.filter(
      user=u,
      content_type=ct_song,
      object_id__in=[s.id for s in songs],
    ).values_list("object_id", flat=True)
  )

  for s in songs:
    if s.id in liked_ids:
      s.is_liked = True

  return songs


def _catalogo_html_admin(request):
  """
  Renderiza el catálogo de canciones públicas para administración,
  incorporando `is_liked` según el usuario actual.
  """
  songs_qs = (
    Song.objects.filter(visibility="public")
    .only(
      "id",
      "title",
      "artist_display_name",
      "owner_user",
      "created_at",
      "cover_image",
      "audio_file",
      "visibility",
      "genre",
    )
    .order_by("-created_at")
  )

  songs = _attach_is_liked(request, songs_qs)

  return render_to_string(
    "gestion/admin_catalogo_songs.html", {"songs": songs}, request=request
  )


def _put_song_undo_artist(request, label: str, data: dict):
  """Registra en sesión la acción de deshacer para el flujo de artista."""
  request.session["song_undo_artist"] = data
  request.session["song_undo_artist_label"] = label
  request.session.modified = True


def _clear_song_undo_artist(request):
  """Limpia de sesión la acción de deshacer del flujo de artista."""
  request.session.pop("song_undo_artist", None)
  request.session.pop("song_undo_artist_label", None)
  request.session.modified = True


def _is_fetch(request) -> bool:
  """Indica si la petición se originó en fetch() (cabecera X-Requested-With=fetch)."""
  return (request.headers.get("X-Requested-With") or "").lower() == "fetch"


def _redirect_login_clean(request):
  """Redirige a login limpiando mensajes previos de la sesión."""
  for _ in _msgs.get_messages(request):
    pass
  return redirect("login")


# Wrappers: no guardan mensajes cuando la llamada es fetch/JSON
def _msg_success(request, text: str):
  if not _is_fetch(request):
    messages.success(request, text)


def _msg_error(request, text: str):
  if not _is_fetch(request):
    messages.error(request, text)


def _msg_info(request, text: str):
  if not _is_fetch(request):
    messages.info(request, text)


def _get_gestion_undo(request):
  """Obtiene de sesión la acción de deshacer del flujo de gestión/admin."""
  return request.session.get("gestion_undo")


def _clear_gestion_undo(request):
  """Limpia de sesión la acción de deshacer del flujo de gestión/admin."""
  request.session.pop("gestion_undo", None)
  request.session.pop("gestion_undo_label", None)
  request.session.modified = True


def _delete_storage_entry(file_or_url) -> None:
  """
  Elimina del storage el archivo referenciado por nombre o URL.
  Errores durante el borrado se ignoran.
  """
  try:
    name = getattr(file_or_url, "name", "") or str(file_or_url) or ""
    base_url = _storage().base_url.rstrip("/") + "/"
    if name.startswith(base_url):
      name = name[len(base_url):].lstrip("/")
    if name:
      _storage().delete(name)
  except Exception:
    pass


# ---------------------------------------------------------------------------
# Vistas: edición y eliminación de canciones
# ---------------------------------------------------------------------------

@require_http_methods(["GET", "POST"])
def editar_cancion(request, song_id: int):
  """
  Edita metadatos de una canción (título, intérprete, género y portada).

  - Método: GET/POST.
  - Permisos: solo administradores.
  - Actualiza el modelo Song y gestiona el reemplazo o borrado de portada.
  - Evita duplicados para el mismo propietario con visibilidad pública.
  """
  username = _require_session_user(request)
  if not username:
    return _redirect_login_clean(request)

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
      _msg_error(request, "El título no puede estar vacío.")
      return redirect("editar_cancion", song_id=song.id)
    if not new_artist:
      _msg_error(request, "El intérprete no puede estar vacío.")
      return redirect("editar_cancion", song_id=song.id)

    try:
      with transaction.atomic():
        # Evita duplicados por mismo owner y visibilidad pública
        dup = (
          Song.objects.filter(
            owner_user=song.owner_user,
            visibility="public",
            title__iexact=new_title,
          )
          .exclude(pk=song.id)
          .exists()
        )
        if dup:
          _msg_error(
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
          name = (
            f"cover_{song.owner_user}_"
            f"{uuid4().hex}{Path(new_cover.name).suffix or ''}"
          )
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

      _msg_success(request, "Cambios guardados.")
      return redirect("gestion")
    except Exception:
      _msg_error(request, "No se pudieron guardar los cambios.")
      return redirect("editar_cancion", song_id=song.id)

  return render(request, "gestion/editar_cancion.html", {"song": song})


@require_http_methods(["POST"])
def eliminar_cancion(request, song_id: int):
  """
  Realiza un soft-delete de una canción (visibility='removed').

  - Método: POST.
  - Permisos:
      * Administrador: cualquier canción.
      * Artista: solo canciones propias.
  - Registra la operación en sesión para poder deshacerla.
  """
  username = _require_session_user(request)
  if not username:
    return _redirect_login_clean(request)

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
      _msg_success(request, "Canción eliminada.")

      if is_admin:
        # Deshacer (gestión/admin)
        request.session["gestion_undo"] = {
          "kind": "restore_song_visibility",
          "song_id": song.id,
          "prev_visibility": prev_visibility,
          "actor": username,
        }
        request.session["gestion_undo_label"] = (
          f"Se eliminó “{song.title}” de {song.artist_display_name}."
        )
        request.session.modified = True
      else:
        # Deshacer (muro/artista)
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
    _msg_error(request, "Error al eliminar la canción.")

  # Respuesta: fetch() vs navegación clásica
  if _is_fetch(request):
    undo_label = (
      request.session.get("gestion_undo_label")
      if is_admin
      else request.session.get("song_undo_artist_label")
    ) or ""
    return JsonResponse({"ok": True, "undo_label": undo_label})

  return redirect("gestion" if is_admin else "mi_muro")


@require_http_methods(["POST"])
def eliminar_canciones_bulk(request):
  """
  Realiza un soft-delete de varias canciones.

  - Método: POST.
  - Permisos:
      * Administrador: cualquier canción.
      * Artista: solo canciones propias.
  - Registra la operación en sesión para poder deshacerla de forma masiva.
  """
  username = _require_session_user(request)
  if not username:
    return _redirect_login_clean(request)

  role = _get_user_role(username)
  is_admin = _is_admin(role)
  is_artist = _is_artist(role)

  raw_ids = request.POST.getlist("ids[]") or request.POST.getlist("ids") or []
  try:
    ids = sorted({int(x) for x in raw_ids})
  except Exception:
    ids = []

  if not ids:
    if _is_fetch(request):
      return JsonResponse(
        {"ok": False, "error": "No hay canciones seleccionadas."}, status=400
      )
    return redirect("gestion" if is_admin else "mi_muro")

  qs = Song.objects.filter(id__in=ids)
  if not is_admin:
    if not is_artist:
      return HttpResponse("No autorizado", status=403)
    qs = qs.filter(owner_user=username)

  prev = list(qs.values("id", "visibility", "title", "artist_display_name"))
  if not prev:
    if _is_fetch(request):
      return JsonResponse(
        {"ok": False, "error": "No se encontraron canciones válidas."},
        status=404,
      )
    return redirect("gestion" if is_admin else "mi_muro")

  try:
    with transaction.atomic():
      qs.update(visibility="removed")

      if is_admin:
        request.session["gestion_undo"] = {
          "kind": "bulk_restore_song_visibility",
          "items": [
            {"song_id": it["id"], "prev_visibility": it["visibility"]}
            for it in prev
          ],
          "actor": username,
        }
        count = len(prev)
        request.session["gestion_undo_label"] = (
          f"Se eliminaron {count} cancion{'es' if count != 1 else ''}."
        )
        request.session.modified = True
      else:
        request.session["song_undo_artist"] = {
          "kind": "bulk_restore_song_visibility_artist",
          "items": [
            {"song_id": it["id"], "prev_visibility": it["visibility"]}
            for it in prev
          ],
          "owner_user": username,
        }
        request.session["song_undo_artist_label"] = (
          f"Eliminaste {len(prev)} cancion{'es' if len(prev) != 1 else ''}."
        )
        request.session.modified = True

  except Exception:
    if _is_fetch(request):
      return JsonResponse(
        {"ok": False, "error": "No fue posible eliminar las canciones."},
        status=500,
      )
    return redirect("gestion" if is_admin else "mi_muro")

  payload = {
    "ok": True,
    "undo_label": (
      request.session.get("gestion_undo_label")
      if is_admin
      else request.session.get("song_undo_artist_label")
    ) or "",
    "removed_ids": [it["id"] for it in prev],
  }
  if is_admin:
    payload["catalogo_html"] = _catalogo_html_admin(request)

  if _is_fetch(request):
    return JsonResponse(payload)

  return redirect("gestion" if is_admin else "mi_muro")


# ---------------------------------------------------------------------------
# Vistas de deshacer
# ---------------------------------------------------------------------------

@require_http_methods(["POST"])
def revertir_cancion(request):
  """
  Deshace la eliminación de una canción en el flujo de gestión/admin
  usando los datos almacenados en sesión (gestion_undo).
  """
  username = _require_session_user(request)
  if not username:
    return _redirect_login_clean(request)

  role = _get_user_role(username)
  if not _is_admin(role):
    return HttpResponse("No autorizado", status=403)

  data = _get_gestion_undo(request)
  if not data or data.get("kind") != "restore_song_visibility":
    _msg_info(request, "No hay ninguna eliminación para deshacer.")
    return redirect("gestion")

  song_id = data.get("song_id")
  prev_visibility = data.get("prev_visibility", "public")

  try:
    with transaction.atomic():
      song = get_object_or_404(Song, id=song_id)
      song.visibility = prev_visibility
      song.save(update_fields=["visibility"])
      _msg_success(request, f"Se restauró la canción “{song.title}”.")
      _clear_gestion_undo(request)
  except Exception:
    _msg_error(request, "No fue posible deshacer la eliminación.")

  if _is_fetch(request):
    return HttpResponse(status=204)
  return redirect("gestion")


@require_http_methods(["POST"])
def revertir_mi_cancion(request):
  """
  Deshace la eliminación en el muro del artista (una o varias canciones),
  usando los datos almacenados en sesión (song_undo_artist).
  """
  username = _require_session_user(request)
  if not username:
    return _redirect_login_clean(request)

  role = _get_user_role(username)
  if not _is_artist(role):
    return HttpResponse("No autorizado", status=403)

  data = request.session.get("song_undo_artist")
  if not data:
    if _is_fetch(request):
      return JsonResponse({"ok": False}, status=400)
    _msg_info(request, "No hay ninguna eliminación para deshacer.")
    return redirect("mi_muro")

  kind = data.get("kind")

  try:
    with transaction.atomic():
      if kind == "restore_song_visibility_artist":
        song_id = int(data.get("song_id"))
        prev_visibility = data.get("prev_visibility", "public")
        song = get_object_or_404(Song, id=song_id)
        if song.owner_user != username:
          return HttpResponse("No autorizado", status=403)
        song.visibility = prev_visibility
        song.save(update_fields=["visibility"])
        _clear_song_undo_artist(request)
        restored_ids = [song_id]

      elif kind == "bulk_restore_song_visibility_artist":
        items = data.get("items") or []
        prev_map = {
          int(it["song_id"]): (it.get("prev_visibility") or "public")
          for it in items
          if "song_id" in it
        }
        ids = list(prev_map.keys())
        songs = list(
          Song.objects.filter(id__in=ids, owner_user=username).only(
            "id", "visibility", "owner_user"
          )
        )
        for s in songs:
          s.visibility = prev_map.get(s.id, "public")
          s.save(update_fields=["visibility"])
        _clear_song_undo_artist(request)
        restored_ids = [s.id for s in songs]

      else:
        _clear_song_undo_artist(request)
        restored_ids = []

  except Exception:
    if _is_fetch(request):
      return JsonResponse({"ok": False}, status=500)
    _msg_error(request, "No fue posible deshacer la eliminación.")
    return redirect("mi_muro")

  if _is_fetch(request):
    return JsonResponse({"ok": True, "restored_ids": restored_ids})

  return redirect("mi_muro")

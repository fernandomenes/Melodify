# gestion/views.py
"""
Vistas de administración: alta/edición de usuarios y catálogo con deshacer
basado en sesión. Reutiliza modelos/utilidades de «inicio_sesion».
"""

from django.contrib import messages
from django.contrib import messages as _msgs
from django.contrib.contenttypes.models import ContentType
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import JsonResponse, HttpResponse
from django.template.loader import render_to_string
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.http import require_http_methods

from inicio_sesion.auth_helpers import _get_user_role, _is_admin, _require_session_user
from inicio_sesion.models import ArtistProfile, LikeMedia, Song, Users

# Importaciones opcionales (si existen los modelos)
try:
    from inicio_sesion.models import Album
except Exception:
    Album = None
try:
    from inicio_sesion.models import Playlist
except Exception:
    Playlist = None


# =============================================================================
# Helpers de deshacer y utilidades de render
# =============================================================================
def _put_undo(request, label: str, data: dict) -> None:
    """Guarda en sesión la última acción de gestión para poder deshacerla."""
    request.session["gestion_undo"] = data
    request.session["gestion_undo_label"] = label
    request.session.modified = True


def _clear_undo(request) -> None:
    """Limpia de sesión cualquier acción pendiente de deshacer."""
    request.session.pop("gestion_undo", None)
    request.session.pop("gestion_undo_label", None)
    request.session.modified = True


def _usuarios_tab_html(request) -> str:
    """Renderiza el fragmento HTML de la pestaña «Usuarios»."""
    admins = Users.objects.filter(type__iexact="administrador").order_by("user")
    artists = (
        Users.objects.filter(type__iexact="artista")
        .select_related("artist_profile")
        .order_by("user")
    )
    viewers = Users.objects.filter(type__iexact="usuario").order_by("user")
    ctx = {"admins": admins, "artists": artists, "viewers": viewers}
    return render_to_string("gestion/_usuarios_tab.html", ctx, request=request)


def _catalogo_html(request) -> str:
    """Renderiza el catálogo de canciones públicas para la pestaña de administración."""
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
        "gestion/admin_catalogo_songs.html",
        {"songs": songs},
        request=request,
    )


def _is_fetch(request) -> bool:
    """Indica si la petición proviene de fetch (cabecera X-Requested-With=fetch)."""
    return (request.headers.get("X-Requested-With") or "").lower() == "fetch"


def _redirect_login_clean(request):
    """Redirige a login consumiendo mensajes previos de la sesión."""
    for _ in _msgs.get_messages(request):
        pass
    return redirect("login")


def _msg_success(request, text: str):
    """Envía un mensaje de éxito solo para peticiones no fetch."""
    if not _is_fetch(request):
        messages.success(request, text)


def _msg_error(request, text: str):
    """Envía un mensaje de error solo para peticiones no fetch."""
    if not _is_fetch(request):
        messages.error(request, text)


def _msg_info(request, text: str):
    """Envía un mensaje informativo solo para peticiones no fetch."""
    if not _is_fetch(request):
        messages.info(request, text)


def _require_admin(request):
    """
    Verifica sesión válida y rol administrador.

    Devuelve (username, error_response), donde error_response es una HttpResponse
    lista para usarse en caso de fallo.
    """
    username = _require_session_user(request)
    if not username:
        return None, _redirect_login_clean(request)
    try:
        u = Users.objects.only("type", "is_superadmin").get(user=username)
    except Users.DoesNotExist:
        return None, _redirect_login_clean(request)
    role = (u.type or "").lower()
    if getattr(u, "is_superadmin", False) or role == "administrador":
        return username, None
    return None, HttpResponse("No autorizado", status=403)


# =============================================================================
# Vistas de Gestión (solo administradores)
# =============================================================================
@require_http_methods(["GET"])
def gestion_dashboard(request):
    """Panel principal de administración: usuarios y catálogo (canciones, álbumes, playlists)."""
    username, error = _require_admin(request)
    if error:
        return error

    admins = Users.objects.filter(type__iexact="administrador").order_by("user")
    artists = (
        Users.objects.filter(type__iexact="artista")
        .select_related("artist_profile")
        .order_by("user")
    )
    viewers = Users.objects.filter(type__iexact="usuario").order_by("user")

    songs = (
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

    albums = Album.objects.all().order_by("-id") if Album else []
    playlists = Playlist.objects.all().order_by("-id") if Playlist else []

    # Estado de deshacer (solo si pertenece al usuario actual)
    undo_data = request.session.get("gestion_undo")
    if undo_data and undo_data.get("actor") != username:
        undo_data = None
    undo_label = request.session.get("gestion_undo_label") if undo_data else None

    # Metadatos del usuario admin en sesión
    role = "administrador"
    avatar_url = ""
    artist_description = ""
    created_at = ""

    try:
        u = Users.objects.select_related("artist_profile").get(user=username)
        if getattr(u, "avatar", None):
            try:
                avatar_url = u.avatar.url
            except Exception:
                avatar_url = ""
        if getattr(u, "artist_profile", None):
            artist_description = (u.artist_profile.description or "").strip()
        if getattr(u, "created_at", None):
            dt = u.created_at
            if timezone.is_naive(dt):
                dt = timezone.make_aware(dt, timezone.get_current_timezone())
            created_at = dt.strftime("%Y-%m-%d %H:%M")
    except Users.DoesNotExist:
        pass

    ctx = {
        "admins": admins,
        "artists": artists,
        "viewers": viewers,
        "songs": songs,
        "albums": albums,
        "playlists": playlists,
        "undo_data": undo_data,
        "undo_label": undo_label,
        "username": username,
        "role": role,
        "avatar_url": avatar_url,
        "artist_description": artist_description,
        "created_at": created_at,
    }
    return render(request, "gestion/gestion.html", ctx)


@require_http_methods(["POST"])
def registrar_artista(request):
    """Alta de usuario con rol «Artista» (con descripción y avatar opcionales)."""
    username, error = _require_admin(request)
    if error:
        return error

    artist_id = (request.POST.get("user") or "").strip()
    password = (request.POST.get("password") or "").strip()
    description = (request.POST.get("description") or "").strip()
    avatar = request.FILES.get("avatar")

    if not artist_id or not password:
        _msg_error(request, "Completa: usuario y contraseña.")
        if _is_fetch(request):
            return JsonResponse({"ok": False, "error": "Completa: usuario y contraseña."})
        return redirect("gestion")

    if len(password) < 6:
        _msg_error(request, "La contraseña debe tener al menos 6 caracteres.")
        if _is_fetch(request):
            return JsonResponse(
                {"ok": False, "error": "La contraseña debe tener al menos 6 caracteres."}
            )
        return redirect("gestion")

    if description and len(description) > 200:
        _msg_error(request, "La descripción no puede superar 200 caracteres.")
        if _is_fetch(request):
            return JsonResponse(
                {"ok": False, "error": "La descripción no puede superar 200 caracteres."}
            )
        return redirect("gestion")

    try:
        with transaction.atomic():
            user = Users.objects.create(user=artist_id, password=password, type="Artista")
            if avatar:
                user.avatar = avatar
                user.save(update_fields=["avatar"])
            ArtistProfile.objects.create(user=user, description=description)

        _msg_success(request, f"Artista '{artist_id}' agregado correctamente.")
        _put_undo(
            request,
            f"Se creó el artista “{artist_id}”.",
            {"kind": "delete_user_created", "username": artist_id, "actor": username},
        )
    except IntegrityError:
        msg = "El usuario ya existe."
        _msg_error(request, msg)
        if _is_fetch(request):
            return JsonResponse({"ok": False, "error": msg})
        return redirect("gestion")
    except Exception:
        msg = "No se pudo agregar el artista. Inténtelo más tarde."
        _msg_error(request, msg)
        if _is_fetch(request):
            return JsonResponse({"ok": False, "error": msg})
        return redirect("gestion")

    if _is_fetch(request):
        return JsonResponse(
            {
                "ok": True,
                "reverted": True,
                "undo_label": request.session.get("gestion_undo_label", ""),
                "usuarios_html": _usuarios_tab_html(request),
            }
        )
    return redirect("gestion")


@require_http_methods(["POST"])
def registrar_admin(request):
    """Alta de usuario con rol «Administrador» (opcionalmente vía fetch con JSON)."""
    session_user, error = _require_admin(request)
    if error:
        return error

    admin_id = (request.POST.get("user") or "").strip()
    password = (request.POST.get("password") or "").strip()
    avatar = request.FILES.get("avatar")

    def _json(ok: bool, **extra):
        """Normaliza la respuesta JSON cuando la petición es fetch()."""
        if _is_fetch(request):
            if ok:
                extra.setdefault("undo_label", request.session.get("gestion_undo_label", ""))
                extra.setdefault("usuarios_html", _usuarios_tab_html(request))
            return JsonResponse({"ok": ok, **extra})
        return None

    if not admin_id or not password:
        _msg_error(request, "Completa: usuario y contraseña.")
        j = _json(False, error="Completa: usuario y contraseña.")
        if j:
            return j
        return redirect("gestion")

    if len(password) < 6:
        _msg_error(request, "La contraseña debe tener al menos 6 caracteres.")
        j = _json(False, error="La contraseña debe tener al menos 6 caracteres.")
        if j:
            return j
        return redirect("gestion")

    try:
        with transaction.atomic():
            user = Users.objects.create(user=admin_id, password=password, type="Administrador")
            if avatar:
                user.avatar = avatar
                user.save(update_fields=["avatar"])

            _msg_success(request, f"Administrador '{admin_id}' agregado.")
            _put_undo(
                request,
                f"Se creó el administrador “{admin_id}”.",
                {"kind": "delete_user_created", "username": admin_id, "actor": session_user},
            )
    except IntegrityError:
        _msg_error(request, "El usuario ya existe.")
        j = _json(False, error="El usuario ya existe.")
        if j:
            return j
        return redirect("gestion")
    except Exception:
        _msg_error(request, "No se pudo agregar el administrador.")
        j = _json(False, error="No se pudo agregar el administrador.")
        if j:
            return j
        return redirect("gestion")

    j = _json(True)
    if j:
        return j
    return redirect("gestion")


@require_http_methods(["POST"])
def desactivar_usuario(request, username: str):
    """Desactiva una cuenta (no aplica a superadmin ni a la propia sesión)."""
    session_user, error = _require_admin(request)
    if error:
        return error

    u = get_object_or_404(Users, user=username)

    if u.is_superadmin:
        _msg_error(request, "La cuenta principal no puede desactivarse.")
        return redirect("gestion")
    if session_user == username:
        _msg_error(request, "No es posible desactivar la propia cuenta.")
        return redirect("gestion")

    u.is_active = False
    u.save(update_fields=["is_active"])
    _msg_success(request, f"Cuenta '{username}' desactivada.")
    _put_undo(
        request,
        f"Se desactivó “{username}”.",
        {"kind": "toggle_active", "username": username, "to": False, "actor": session_user},
    )
    if _is_fetch(request):
        return JsonResponse(
            {
                "ok": True,
                "reverted": True,
                "undo_label": request.session.get("gestion_undo_label", ""),
                "usuarios_html": _usuarios_tab_html(request),
            }
        )

    return redirect("gestion")


@require_http_methods(["POST"])
def activar_usuario(request, username: str):
    """Activa una cuenta previamente desactivada."""
    _, error = _require_admin(request)
    if error:
        return error

    u = get_object_or_404(Users, user=username)
    u.is_active = True
    u.save(update_fields=["is_active"])
    _msg_success(request, f"Cuenta '{username}' activada.")
    _put_undo(
        request,
        f"Se activó “{username}”.",
        {"kind": "toggle_active", "username": username, "to": True},
    )
    if _is_fetch(request):
        return JsonResponse(
            {
                "ok": True,
                "reverted": True,
                "undo_label": request.session.get("gestion_undo_label", ""),
                "usuarios_html": _usuarios_tab_html(request),
            }
        )
    return redirect("gestion")


@require_http_methods(["GET", "POST"])
def editar_usuario(request, username: str):
    """Edición de datos de un usuario: nombre, contraseña, rol, avatar y perfil de artista."""
    session_user, error = _require_admin(request)
    if error:
        return error

    u = get_object_or_404(Users, user=username)
    target_is_super = bool(getattr(u, "is_superadmin", False))
    session_is_super = Users.objects.filter(user=session_user, is_superadmin=True).exists()

    if request.method == "POST":
        new_user = (request.POST.get("user") or "").strip()
        new_password = (request.POST.get("password") or "").strip()
        new_role = (request.POST.get("role") or u.type or "").strip().lower()
        description = (request.POST.get("description") or "").strip()
        remove_avatar = (request.POST.get("remove_avatar") or "") == "1"
        avatar_file = request.FILES.get("avatar")

        # Reglas sobre superadmin
        if target_is_super and not session_is_super:
            new_password = ""
            new_role = (u.type or "").lower()
        elif target_is_super and session_is_super:
            new_role = (u.type or "").lower()

        allowed_roles = {"administrador", "artista", "usuario"}
        if new_role not in allowed_roles:
            _msg_error(request, "Rol inválido.")
            return redirect("editar_usuario", username=u.user)

        if not new_user:
            _msg_error(request, "El nombre de usuario no puede estar vacío.")
            return redirect("editar_usuario", username=u.user)

        if new_role == "artista" and not target_is_super and not description:
            _msg_error(request, "La descripción es obligatoria para artistas.")
            return redirect("editar_usuario", username=u.user)

        try:
            with transaction.atomic():
                # Cambio de username propagando ownership de canciones
                if new_user != u.user:
                    if Users.objects.filter(user=new_user).exclude(pk=u.pk).exists():
                        _msg_error(request, "Ese nombre de usuario ya existe.")
                        return redirect("editar_usuario", username=u.user)
                    old_user = u.user
                    u.user = new_user
                    u.save(update_fields=["user"])
                    Song.objects.filter(owner_user=old_user).update(owner_user=new_user)
                    if session_user == old_user:
                        request.session["user"] = new_user

                if new_password:
                    u.password = new_password

                prev_role = (u.type or "").lower()
                if not target_is_super and new_role != prev_role:
                    u.type = new_role

                if remove_avatar:
                    if getattr(u, "avatar", None):
                        u.avatar.delete(save=False)
                    u.avatar = None
                elif avatar_file:
                    u.avatar = avatar_file

                u.save()

                # Perfil de artista según rol actual
                if not target_is_super:
                    if (u.type or "").lower() == "artista":
                        try:
                            ap = u.artist_profile
                            ap.description = description
                            ap.save(update_fields=["description"])
                        except ArtistProfile.DoesNotExist:
                            ArtistProfile.objects.create(user=u, description=description)
                    else:
                        try:
                            u.artist_profile.delete()
                        except ArtistProfile.DoesNotExist:
                            pass

            _msg_success(request, "Cambios guardados.")
            _clear_undo(request)
            return redirect("gestion")
        except Exception:
            _msg_error(request, "No se pudieron guardar los cambios.")
            return redirect("editar_usuario", username=username)

    ctx = {"user_obj": u, "session_is_superadmin": session_is_super}
    return render(request, "gestion/editar_usuario.html", ctx)


@require_http_methods(["POST"])
def eliminar_usuario(request, username: str):
    """Elimina una cuenta. Para artistas, aplica soft-delete a canciones públicas."""
    session_user, error = _require_admin(request)
    if error:
        return error

    u = get_object_or_404(Users, user=username)
    if u.is_superadmin:
        _msg_error(request, "La cuenta principal no puede eliminarse.")
        return redirect("gestion")
    if session_user == username:
        _msg_error(request, "No es posible eliminar la propia cuenta.")
        return redirect("gestion")

    try:
        with transaction.atomic():
            role_lower = (u.type or "").lower()
            songs_ids = list(
                Song.objects.filter(owner_user=username, visibility="public").values_list(
                    "id", flat=True
                )
            )
            description = ""
            if role_lower == "artista":
                try:
                    description = (u.artist_profile.description or "").strip()
                except ArtistProfile.DoesNotExist:
                    description = ""
            avatar_name = u.avatar.name if getattr(u, "avatar", None) else ""

            undo_payload = {
                "kind": "restore_deleted_user",
                "username": u.user,
                "password": u.password,
                "type": u.type,
                "was_active": bool(u.is_active),
                "avatar": avatar_name,
                "description": description,
                "song_ids": songs_ids,
                "actor": session_user,
            }

            if role_lower == "artista" and songs_ids:
                Song.objects.filter(id__in=songs_ids).update(visibility="removed")

            u.delete()

        _msg_success(request, f"Cuenta '{username}' eliminada.")
        _put_undo(request, f"Se eliminó “{username}”.", undo_payload)
    except Exception:
        _msg_error(request, "No se pudo eliminar la cuenta.")
    if _is_fetch(request):
        return JsonResponse(
            {
                "ok": True,
                "reverted": True,
                "undo_label": request.session.get("gestion_undo_label", ""),
                "usuarios_html": _usuarios_tab_html(request),
            }
        )

    return redirect("gestion")


@require_http_methods(["POST"])
def revertir_accion(request):
    """Deshace la última acción registrada en sesión para la sección de gestión."""
    username, error = _require_admin(request)
    if error:
        return error

    data = request.session.get("gestion_undo")
    if not data:
        _msg_info(request, "No hay ninguna acción para deshacer.")
        if _is_fetch(request):
            return JsonResponse({"ok": False})
        return redirect("gestion")

    kind = data.get("kind")
    resp = {"ok": True}

    try:
        with transaction.atomic():
            if kind == "toggle_active":
                uname = data.get("username")
                to = data.get("to", True)
                u = get_object_or_404(Users, user=uname)
                u.is_active = not bool(to)
                u.save(update_fields=["is_active"])
                _msg_success(request, f"Se revirtió el estado de “{uname}”.")
                _clear_undo(request)
                resp["usuarios_html"] = _usuarios_tab_html(request)

            elif kind == "delete_user_created":
                uname = data.get("username")
                try:
                    u = Users.objects.get(user=uname)
                except Users.DoesNotExist:
                    _msg_info(request, "Nada que deshacer: la cuenta no existe.")
                else:
                    if u.is_superadmin:
                        _msg_error(request, "No se puede deshacer sobre la cuenta principal.")
                    else:
                        try:
                            u.artist_profile.delete()
                        except ArtistProfile.DoesNotExist:
                            pass
                        u.delete()
                        _msg_success(request, f"Se deshizo la creación de “{uname}”.")
                _clear_undo(request)
                resp["usuarios_html"] = _usuarios_tab_html(request)

            elif kind == "restore_deleted_user":
                uname = data.get("username")
                if Users.objects.filter(user=uname).exists():
                    _msg_error(request, f"No se puede deshacer: ya existe “{uname}”.")
                    _clear_undo(request)
                else:
                    u = Users.objects.create(
                        user=uname,
                        password=data.get("password") or "",
                        type=data.get("type") or "usuario",
                        is_active=bool(data.get("was_active", True)),
                    )
                    avatar = data.get("avatar")
                    if avatar:
                        u.avatar = avatar
                        u.save(update_fields=["avatar"])
                    if (u.type or "").lower() == "artista":
                        ArtistProfile.objects.create(
                            user=u, description=data.get("description") or ""
                        )
                    song_ids = data.get("song_ids") or []
                    if song_ids:
                        Song.objects.filter(id__in=song_ids).update(visibility="public")
                    _msg_success(request, f"Se restauró la cuenta “{uname}”.")
                    _clear_undo(request)
                resp["usuarios_html"] = _usuarios_tab_html(request)

            elif kind == "restore_song_visibility":
                sid = data.get("song_id")
                prev = data.get("prev_visibility", "public")
                song = get_object_or_404(Song, id=sid)
                song.visibility = prev
                song.save(update_fields=["visibility"])
                _msg_success(request, f"Se restauró “{song.title}”.")
                _clear_undo(request)
                resp["catalogo_html"] = _catalogo_html(request)

            elif kind == "bulk_restore_song_visibility":
                items = data.get("items") or []
                if not items:
                    _msg_info(request, "Nada que deshacer.")
                    _clear_undo(request)
                else:
                    prev_map = {
                        int(it["song_id"]): (it.get("prev_visibility") or "public")
                        for it in items
                        if "song_id" in it
                    }
                    ids = list(prev_map.keys())
                    songs = list(Song.objects.filter(id__in=ids).only("id", "visibility"))
                    for s in songs:
                        s.visibility = prev_map.get(s.id, "public")
                        s.save(update_fields=["visibility"])
                    _msg_success(request, f"Se restauraron {len(songs)} canciones.")
                    _clear_undo(request)

                resp["catalogo_html"] = _catalogo_html(request)

            else:
                _msg_info(request, "Esta acción no admite deshacer.")
                _clear_undo(request)

    except Exception:
        if _is_fetch(request):
            return JsonResponse({"ok": False})
        _msg_error(request, "No fue posible deshacer la última acción.")
        return redirect("gestion")

    if _is_fetch(request):
        return JsonResponse(resp)
    return redirect("gestion")


# =============================================================================
# Pestaña «Catálogo»: fragmento HTML y JSON
# =============================================================================
@require_http_methods(["GET"])
def catalogo_admin_fragment(request):
    """Devuelve el HTML parcial del catálogo filtrado por artista y/o texto de búsqueda."""
    _, error = _require_admin(request)
    if error:
        return error

    artist = (request.GET.get("artist") or "").strip()
    q = (request.GET.get("q") or "").strip()

    qs = Song.objects.filter(visibility="public")
    if artist:
        qs = qs.filter(owner_user=artist)
    if q:
        qs = qs.filter(Q(title__icontains=q) | Q(artist_display_name__icontains=q))

    songs_qs = qs.only(
        "id",
        "title",
        "artist_display_name",
        "owner_user",
        "created_at",
        "cover_image",
        "audio_file",
        "genre",
    ).order_by("-created_at")

    songs = _attach_is_liked(request, songs_qs)

    return render(
        request,
        "gestion/admin_catalogo_songs.html",
        {"songs": songs, "artist_filter": artist, "q": q},
    )


def _attach_is_liked(request, songs):
    """
    Marca cada canción con el atributo booleano `is_liked` para el usuario
    actual de la sesión.
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


@require_http_methods(["GET"])
def catalogo_admin_json(request):
    """Devuelve JSON de canciones públicas, filtradas por artista y fecha mínima (since)."""
    _, error = _require_admin(request)
    if error:
        return error

    artist = (request.GET.get("artist") or "").strip()
    since_raw = (request.GET.get("since") or "").strip()

    qs = Song.objects.filter(visibility="public")
    if artist:
        qs = qs.filter(owner_user=artist)

    if since_raw:
        dt = parse_datetime(since_raw)
        if dt is not None:
            if timezone.is_naive(dt):
                dt = timezone.make_aware(dt, timezone.get_current_timezone())
            qs = qs.filter(created_at__gt=dt)

    qs = qs.order_by("-created_at")
    items = list(
        qs.values(
            "id",
            "title",
            "artist_display_name",
            "owner_user",
            "created_at",
            "cover_image",
            "audio_file",
        )
    )

    latest = None
    if items:
        latest = items[0]["created_at"]
        if latest is not None and timezone.is_naive(latest):
            latest = timezone.make_aware(latest, timezone.get_current_timezone())

    payload = {
        "latest_created_at": latest.isoformat() if latest else "",
        "count": len(items),
        "songs": [
            {
                **it,
                "created_at": (
                    it["created_at"].isoformat() if it["created_at"] is not None else ""
                ),
            }
            for it in items
        ],
    }
    return JsonResponse(payload)


# =============================================================================
# Borrado múltiple de canciones (botón «Eliminar seleccionadas»)
# =============================================================================
@require_http_methods(["POST"])
def eliminar_canciones_multiples(request):
    """Soft-delete de varias canciones, dejando estado de deshacer en sesión."""
    session_user, error = _require_admin(request)
    if error:
        return error

    ids = request.POST.getlist("ids[]") or request.POST.getlist("ids")
    if not ids:
        raw = (request.POST.get("ids_csv") or "").strip()
        if raw:
            ids = [x for x in raw.split(",") if x]

    try:
        ids = [int(x) for x in ids]
    except (TypeError, ValueError):
        return JsonResponse({"ok": False, "error": "IDs inválidos."}, status=400)

    if not ids:
        return JsonResponse({"ok": False, "error": "Sin selección."}, status=400)

    songs = list(Song.objects.filter(id__in=ids).only("id", "visibility", "title"))
    if not songs:
        return JsonResponse({"ok": False, "error": "No se encontraron canciones."}, status=404)

    items = [{"song_id": s.id, "prev_visibility": (s.visibility or "public")} for s in songs]
    removed_ids = [s.id for s in songs]

    try:
        with transaction.atomic():
            Song.objects.filter(id__in=removed_ids).update(visibility="removed")
            _put_undo(
                request,
                f"Se eliminaron {len(removed_ids)} canciones.",
                {"kind": "bulk_restore_song_visibility", "items": items, "actor": session_user},
            )
    except Exception:
        return JsonResponse({"ok": False, "error": "No se pudo eliminar."}, status=500)

    return JsonResponse(
        {
            "ok": True,
            "removed_ids": removed_ids,
            "undo_label": request.session.get("gestion_undo_label", ""),
            "catalogo_html": _catalogo_html(request),
        }
    )


# Alias por compatibilidad con referencias previas
eliminar_canciones_bulk = eliminar_canciones_multiples

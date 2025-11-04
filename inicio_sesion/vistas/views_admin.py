# inicio_sesion/vistas/views_admin.py
from django.contrib import messages
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.http import require_http_methods

from ..auth_helpers import _get_user_role, _is_admin, _require_session_user
from ..models import ArtistProfile, Song, Users

# Importaciones opcionales (si no existen los modelos, el dashboard los ignora).
try:
    from ..models import Album  # type: ignore
except Exception:
    Album = None  # type: ignore

try:
    from ..models import Playlist  # type: ignore
except Exception:
    Playlist = None  # type: ignore


# =========================
# Helpers de "Deshacer"
# =========================
def _put_undo(request, label: str, data: dict):
    """Guarda en sesión el último cambio para permitir su reversión."""
    request.session["gestion_undo"] = data
    request.session["gestion_undo_label"] = label
    request.session.modified = True


def _clear_undo(request):
    """Limpia el estado de deshacer en la sesión."""
    request.session.pop("gestion_undo", None)
    request.session.pop("gestion_undo_label", None)
    request.session.modified = True


def _require_admin(request):
    """
    Verifica que exista sesión y que el usuario tenga rol de administrador.
    """
    username = _require_session_user(request)
    if not username:
        return None, redirect("login")
    try:
        u = Users.objects.only("type", "is_superadmin").get(user=username)
    except Users.DoesNotExist:
        return None, redirect("login")
    role = (u.type or "").lower()
    if getattr(u, "is_superadmin", False) or role == "administrador":
        return username, None
    return None, HttpResponse("No autorizado", status=403)


# =========================
# Vistas de Gestión (solo administradores)
# =========================
@require_http_methods(["GET"])
def gestion_dashboard(request):
    """
    Muestra el panel de administración:
      - Formularios de alta de artista/administrador.
      - Pestaña "Usuarios": admins, artistas y usuarios.
      - Pestaña "Catálogo": canciones públicas (y álbumes/playlists si existen).
    """
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

    undo_data = request.session.get("gestion_undo")
    if undo_data and undo_data.get("actor") != username:
        undo_data = None
    undo_label = request.session.get("gestion_undo_label") if undo_data else None

    # ===== Variables para data-* en el template =====
    role = "administrador"  # garantizado por _require_admin
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
        # Para el template (data-*)
        "username": username,
        "role": role,
        "avatar_url": avatar_url,
        "artist_description": artist_description,
        "created_at": created_at,
    }
    return render(request, "inicio_sesion/gestion.html", ctx)


@require_http_methods(["POST"])
def registrar_artista(request):
    """Crea un usuario con rol Artista y su perfil asociado."""
    username, error = _require_admin(request)
    if error:
        return error

    artist_id = (request.POST.get("user") or "").strip()
    password = (request.POST.get("password") or "").strip()
    description = (request.POST.get("description") or "").strip()
    avatar = request.FILES.get("avatar")

    if not artist_id or not description or not password:
        messages.error(request, "Completa: usuario, descripción y contraseña.")
        return redirect("gestion")
    if len(description) > 200:
        messages.error(request, "La descripción no puede superar 200 caracteres.")
        return redirect("gestion")

    try:
        with transaction.atomic():
            user = Users.objects.create(user=artist_id, password=password, type="artista")
            if avatar:
                user.avatar = avatar
                user.save(update_fields=["avatar"])
            ArtistProfile.objects.create(user=user, description=description)

        messages.success(request, f"Artista '{artist_id}' agregado correctamente.")
        _put_undo(
            request,
            f"Se creó el artista “{artist_id}”.",
            {"kind": "delete_user_created", "username": artist_id, "actor": username},
        )
    except IntegrityError:
        messages.error(request, "El usuario ya existe.")
    except Exception:
        messages.error(request, "No se pudo agregar el artista. Inténtalo más tarde.")
    return redirect("gestion")


@require_http_methods(["POST"])
def registrar_admin(request):
    """Crea un usuario con rol Administrador."""
    username, error = _require_admin(request)
    if error:
        return error

    admin_id = (request.POST.get("user") or "").strip()
    password = (request.POST.get("password") or "").strip()
    avatar = request.FILES.get("avatar")

    if not admin_id or not password:
        messages.error(request, "Completa: usuario y contraseña.")
        return redirect("gestion")

    try:
        user = Users.objects.create(user=admin_id, password=password, type="administrador")
        if avatar:
            user.avatar = avatar
            user.save(update_fields=["avatar"])

        messages.success(request, f"Administrador '{admin_id}' agregado.")
        _put_undo(
            request,
            f"Se creó el administrador “{admin_id}”.",
            {"kind": "delete_user_created", "username": admin_id, "actor": username},
        )
    except IntegrityError:
        messages.error(request, "El usuario ya existe.")
    except Exception:
        messages.error(request, "No se pudo agregar el administrador. Inténtalo más tarde.")
    return redirect("gestion")


@require_http_methods(["POST"])
def desactivar_usuario(request, username: str):
    """Desactiva una cuenta (no aplicable a superadmin ni a la propia sesión)."""
    session_user, error = _require_admin(request)
    if error:
        return error

    u = get_object_or_404(Users, user=username)

    if u.is_superadmin:
        messages.error(request, "La cuenta principal no puede desactivarse.")
        return redirect("gestion")
    if session_user == username:
        messages.error(request, "No puedes desactivar tu propia cuenta.")
        return redirect("gestion")

    u.is_active = False
    u.save(update_fields=["is_active"])
    messages.success(request, f"Cuenta '{username}' desactivada.")
    _put_undo(
        request,
        f"Se desactivó “{username}”.",
        {"kind": "toggle_active", "username": username, "to": False, "actor": session_user},
    )
    return redirect("gestion")


@require_http_methods(["POST"])
def activar_usuario(request, username: str):
    """Activa una cuenta."""
    _, error = _require_admin(request)
    if error:
        return error

    u = get_object_or_404(Users, user=username)
    u.is_active = True
    u.save(update_fields=["is_active"])
    messages.success(request, f"Cuenta '{username}' activada.")
    _put_undo(
        request,
        f"Se activó “{username}”.",
        {
            "kind": "toggle_active",
            "username": username,
            "to": True,
        },
    )
    return redirect("gestion")


@require_http_methods(["GET", "POST"])
def editar_usuario(request, username: str):
    """
    Edita datos de un usuario. Permite:
      - Cambio de username (migra ownership de canciones).
      - Cambio de password y rol (con restricciones para superadmin).
      - Gestión de avatar y descripción de artista.
    """
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

        if target_is_super and not session_is_super:
            new_password = ""
            new_role = (u.type or "").lower()
        elif target_is_super and session_is_super:
            new_role = (u.type or "").lower()

        allowed_roles = {"administrador", "artista", "usuario"}
        if new_role not in allowed_roles:
            messages.error(request, "Rol inválido.")
            return redirect("editar_usuario", username=u.user)

        if not new_user:
            messages.error(request, "El nombre de usuario no puede estar vacío.")
            return redirect("editar_usuario", username=u.user)

        if new_role == "artista" and not target_is_super:
            if not description:
                messages.error(request, "La descripción es obligatoria para artistas.")
                return redirect("editar_usuario", username=u.user)

        try:
            with transaction.atomic():
                if new_user != u.user:
                    if Users.objects.filter(user=new_user).exclude(pk=u.pk).exists():
                        messages.error(request, "Ese nombre de usuario ya existe.")
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

            messages.success(request, "Cambios guardados.")
            _clear_undo(request)
            return redirect("gestion")
        except Exception:
            messages.error(request, "No se pudieron guardar los cambios.")
            return redirect("editar_usuario", username=username)

    ctx = {"user_obj": u, "session_is_superadmin": session_is_super}
    return render(request, "inicio_sesion/editar_usuario.html", ctx)


@require_http_methods(["POST"])
def eliminar_usuario(request, username: str):
    """Elimina una cuenta (con soft-delete de canciones si es artista)."""
    session_user, error = _require_admin(request)
    if error:
        return error

    u = get_object_or_404(Users, user=username)
    if u.is_superadmin:
        messages.error(request, "La cuenta principal no puede eliminarse.")
        return redirect("gestion")
    if session_user == username:
        messages.error(request, "No puedes eliminar tu propia cuenta.")
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

        messages.success(request, f"Cuenta '{username}' eliminada.")
        _put_undo(request, f"Se eliminó “{username}”.", undo_payload)
    except Exception:
        messages.error(request, "No se pudo eliminar la cuenta.")
    return redirect("gestion")


@require_http_methods(["POST"])
def revertir_accion(request):
    """
    Revierte la última acción guardada en sesión.

    Tipos soportados (data['kind']):
      - toggle_active: invierte activación de usuario.
      - delete_user_created: elimina la cuenta recién creada.
      - restore_deleted_user: recrea cuenta eliminada y restaura visibilidad de canciones.
      - restore_song_visibility: restaura la visibilidad previa de una canción.
    """
    username, error = _require_admin(request)
    if error:
        return error

    data = request.session.get("gestion_undo")
    if not data:
        messages.info(request, "No hay ninguna acción para deshacer.")
        return redirect("gestion")

    kind = data.get("kind")
    try:
        with transaction.atomic():
            if kind == "toggle_active":
                uname = data.get("username")
                to = data.get("to", True)
                u = get_object_or_404(Users, user=uname)
                u.is_active = not bool(to)
                u.save(update_fields=["is_active"])
                messages.success(request, f"Se revirtió el estado de “{uname}”.")
                _clear_undo(request)

            elif kind == "delete_user_created":
                uname = data.get("username")
                try:
                    u = Users.objects.get(user=uname)
                except Users.DoesNotExist:
                    messages.info(request, "Nada que deshacer: la cuenta ya no existe.")
                else:
                    if u.is_superadmin:
                        messages.error(request, "No se puede deshacer sobre la cuenta principal.")
                    else:
                        try:
                            u.artist_profile.delete()
                        except ArtistProfile.DoesNotExist:
                            pass
                        u.delete()
                        messages.success(request, f"Se deshizo la creación de “{uname}”.")
                _clear_undo(request)

            elif kind == "restore_deleted_user":
                uname = data.get("username")
                if Users.objects.filter(user=uname).exists():
                    messages.error(
                        request,
                        f"No se puede deshacer: ya existe una cuenta con ID “{uname}”.",
                    )
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

                    messages.success(request, f"Se restauró la cuenta “{uname}”.")
                    _clear_undo(request)

            elif kind == "restore_song_visibility":
                sid = data.get("song_id")
                prev = data.get("prev_visibility", "public")
                song = get_object_or_404(Song, id=sid)
                song.visibility = prev
                song.save(update_fields=["visibility"])
                messages.success(request, f"Se restauró “{song.title}”.")
                _clear_undo(request)

            else:
                messages.info(request, "Esta acción no admite deshacer.")
                _clear_undo(request)

    except Exception:
        messages.error(request, "No fue posible deshacer la última acción.")
    return redirect("gestion")


# =========================================================
# Pestaña "Catálogo": fragmento HTML y JSON
# =========================================================
@require_http_methods(["GET"])
def catalogo_admin_fragment(request):
    """
    Devuelve el HTML parcial del catálogo de canciones filtrado.

    Query params:
      - artist (str, opcional): username del artista.
      - q (str, opcional): texto a buscar en título o intérprete.
    """
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

    songs = qs.only(
        "id",
        "title",
        "artist_display_name",
        "owner_user",
        "created_at",
        "cover_image",
        "audio_file",
    ).order_by("-created_at")

    return render(
        request,
        "inicio_sesion/admin_catalogo_songs.html",
        {"songs": songs, "artist_filter": artist, "q": q},
    )


@require_http_methods(["GET"])
def catalogo_admin_json(request):
    """
    Devuelve JSON para polling de nuevas canciones.

    Query params:
      - artist (str, opcional): username del artista.
      - since (ISO8601, opcional): límite inferior de created_at (exclusivo).

    Respuesta:
      {
        "latest_created_at": "<ISO8601|''>",
        "count": <int>,
        "songs": [ { ... } ]
      }
    """
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

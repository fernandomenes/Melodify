import json
import logging

from django.contrib import messages
from django.contrib.auth import logout as django_logout
from django.contrib.contenttypes.models import ContentType
from django.db import IntegrityError
from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.csrf import csrf_exempt, csrf_protect
from django.views.decorators.http import require_GET, require_POST, require_http_methods

from .models import (
    ArtistProfile,
    FollowArtist,
    LikeMedia,
    PlayList,
    PlayListSong,
    PlaylistCollaborator,
    Song,
    Users,
)

logger = logging.getLogger(__name__)


# ======================================================================
# Helpers genéricos
# ======================================================================


def _safe_file_url(f):
    """
    Devuelve una URL segura para un FileField/ImageField o cadena vacía.

    - Si no hay archivo → "".
    - Si hay error al acceder a .url → str(f) o "".
    """
    if not f:
        return ""
    try:
        return f.url if getattr(f, "name", "") else ""
    except Exception:
        try:
            return str(f)
        except Exception:
            return ""


def _song_audio_url(song):
    """Devuelve la URL de audio de una Song o cadena vacía."""
    return _safe_file_url(getattr(song, "audio_file", None)) or ""


def _song_cover_url(song):
    """Devuelve la URL de portada de una Song o None."""
    cover = _safe_file_url(getattr(song, "cover_image", None))
    return cover or None


def _get_session_user_obj(request):
    """
    Devuelve la instancia Users asociada a request.session['user'],
    o None si no existe o no es válida.
    """
    username = request.session.get("user")
    if not username:
        return None
    try:
        return Users.objects.get(user=username)
    except Users.DoesNotExist:
        return None


def _is_admin(user):
    """True si el usuario tiene rol de administrador o está marcado como superadmin."""
    if not user:
        return False
    if getattr(user, "is_superadmin", False):
        return True
    return (user.type or "").lower() == "administrador"


def _user_can_edit_playlist(user, playlist):
    """
    True si el usuario puede editar el contenido de una playlist:

    - Owner de la playlist (idUser).
    - Administrador / superadmin.
    - Colaborador registrado en PlaylistCollaborator.
    """
    if not user or not playlist:
        return False

    # Dueño
    if getattr(playlist, "idUser", None) == getattr(user, "id", None):
        return True

    # Admin
    if _is_admin(user):
        return True

    # Colaborador (semántica de editor)
    try:
        return PlaylistCollaborator.objects.filter(
            playlist_id=playlist.id,
            user=user,
        ).exists()
    except Exception:
        logger.exception("_user_can_edit_playlist: error consultando colaboradores")
        return False


# ======================================================================
# Pantallas básicas (pública / autenticación / home)
# ======================================================================


def pantallaPrincipal(request):
    """Pantalla pública principal (landing)."""
    return render(request, "inicio_sesion/principal.html")


def pantallaHome(request):
    """
    Pantalla principal autenticada (Home SPA).

    Requiere usuario en sesión (modelo Users guardado en request.session).
    Incluye:
    - Datos básicos del usuario.
    - Playlist virtual “Mi música” si es artista.
    """
    if "user" not in request.session:
        messages.error(request, "Debes iniciar sesión para acceder a esta página.")
        return redirect("login")

    session_user = request.session.get("user", "")
    session_role = request.session.get("role", "")
    role_lower = (session_role or "").lower()

    avatar_url = ""
    artist_description = ""
    created_at_str = ""

    # Datos básicos del usuario en sesión
    try:
        u = Users.objects.get(user=session_user)

        if getattr(u, "avatar", None):
            avatar_url = _safe_file_url(u.avatar)

        if getattr(u, "created_at", None):
            created_at_str = u.created_at.strftime("%Y-%m-%d %H:%M")

        if role_lower == "artista":
            try:
                artist_description = (u.artist_profile.description or "").strip()
            except ArtistProfile.DoesNotExist:
                artist_description = ""
    except Users.DoesNotExist:
        pass

    # Playlist virtual “Mi música” (rol artista)
    playlists = []
    if role_lower == "artista":
        qs = Song.objects.filter(
            owner_user=session_user,
            visibility="public",
        ).only(
            "id",
            "title",
            "artist_display_name",
            "audio_file",
            "cover_image",
            "genre",
        )

        songs = [
            {
                "id": s.id,
                "title": s.title,
                "author": s.artist_display_name,
                "audioUrl": _song_audio_url(s),
                "coverUrl": _song_cover_url(s),
                "genre": getattr(s, "genre", "") or "",
            }
            for s in qs
            if _song_audio_url(s)
        ]

        playlists.append(
            {
                "id": 1,
                "name": "Mi música",
                "songs": songs,
            }
        )

    ctx = {
        "session_user": session_user,
        "session_role": session_role,
        "session_avatar_url": avatar_url,
        "session_description": artist_description,
        "session_created_at": created_at_str,
        "playlists_json": json.dumps(playlists),
    }
    return render(request, "inicio_sesion/home.html", ctx)


def pantallaRegistro(request):
    """
    Pantalla de registro basada en el modelo Users (contraseña en texto plano).

    NOTA: esta lógica no usa el sistema de auth de Django; se mantiene
    por compatibilidad con el resto de la app.
    """
    if request.method == "POST":
        username = request.POST.get("username", "")
        password = request.POST.get("password", "")
        confirm_password = request.POST.get("confirm_password", "")

        errors = []

        if password != confirm_password:
            errors.append("Las contraseñas no coinciden.")
        if Users.objects.filter(user=username).exists():
            errors.append("El nombre de usuario ya existe.")
        if len(password) < 6:
            errors.append("La contraseña debe tener al menos 6 caracteres.")
        if not username.strip():
            errors.append("El nombre de usuario no puede estar vacío.")

        if not errors:
            try:
                Users.objects.create(
                    user=username.strip(),
                    password=password,
                    type="Usuario",
                    is_superadmin=False,
                    is_active=True,
                )
                messages.success(
                    request, "¡Registro exitoso! Ahora puedes iniciar sesión."
                )
                return redirect("login")
            except Exception:
                logger.exception("Error al crear usuario en pantallaRegistro")
                errors.append("Error al crear el usuario. Intenta de nuevo más tarde.")

        for error in errors:
            messages.error(request, error)

    return render(request, "inicio_sesion/registro.html")


@require_http_methods(["GET", "POST"])
@csrf_protect
def pantallaLogout(request):
    """
    Cierra sesión, limpia la sesión y deshabilita caché de la página anterior.

    Se usa tanto en peticiones GET como POST por compatibilidad con formularios/botones.
    """
    request.session.flush()
    django_logout(request)

    messages.success(request, "Sesión cerrada correctamente.")

    response = redirect("login")
    response["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response["Pragma"] = "no-cache"
    response["Expires"] = "0"
    return response


def pantallaLogin(request):
    """
    Inicio de sesión utilizando el modelo Users almacenado en sesión.

    Se mantiene la autenticación manual (sin auth.User) por compatibilidad
    con el resto del proyecto.
    """
    if request.method == "POST":
        user = request.POST.get("user")
        password = request.POST.get("password")

        try:
            usuario_db = Users.objects.get(user=user, password=password)

            # Evitar fijación de sesión + limpiar posibles datos de undo viejos
            request.session.cycle_key()
            for k in [
                "gestion_undo",
                "gestion_undo_label",
                "mi_muro_undo",
                "mi_muro_undo_label",
                "song_undo",
                "song_undo_label",
                "song_undo_artist",
                "song_undo_artist_label",
            ]:
                request.session.pop(k, None)

            request.session["user"] = usuario_db.user
            request.session["role"] = usuario_db.type or ""

            return redirect("home")

        except Users.DoesNotExist:
            return render(
                request,
                "inicio_sesion/login.html",
                {"error": "Usuario o contraseña incorrectos"},
            )

    return render(request, "inicio_sesion/login.html")


# ======================================================================
# Playlists (API JSON usada por la SPA y buscador)
# ======================================================================


@require_GET
def get_user_id(request):
    """Devuelve el ID de usuario activo dado el parámetro ?user=."""
    username = request.GET.get("user")
    if not username:
        return JsonResponse({"error": 'Parámetro "user" es requerido'}, status=400)

    try:
        user_obj = Users.objects.get(user=username, is_active=True)
        return JsonResponse({"id": user_obj.id})
    except Users.DoesNotExist:
        return JsonResponse(
            {"error": "Usuario no encontrado o inactivo"},
            status=404,
        )


@require_GET
def playlist_getAll(request):
    """
    Devuelve playlists visibles y marca metadatos por usuario:

    - isMine: playlists donde el usuario de referencia es dueño.
    - isCollaborator: playlists donde el usuario de referencia es colaborador.
    - canEdit: dueño, admin o colaborador (para el usuario en sesión).
    """
    session_user = _get_session_user_obj(request)

    # Usuario de referencia para isMine / isCollaborator (por ?u= o sesión)
    username_param = (request.GET.get("u") or "").strip()

    target_user = None
    if username_param:
        try:
            target_user = Users.objects.get(user=username_param, is_active=True)
        except Users.DoesNotExist:
            target_user = None
        except Exception:
            # Si el modelo Users está raro, mejor no tronar
            logger.exception("playlist_getAll: error obteniendo target_user")
            target_user = None

    if target_user is None:
        target_user = session_user

    target_id = target_user.id if target_user else None

    # ------------------------------------------------------------------
    # Colaboraciones del usuario de referencia (incluyen playlists privadas)
    # ------------------------------------------------------------------
    collab_playlist_ids = set()
    if target_user:
        try:
            collab_playlist_ids = set(
                PlaylistCollaborator.objects.filter(
                    user=target_user
                ).values_list("playlist_id", flat=True)
            )
        except Exception:
            logger.exception(
                "playlist_getAll: error leyendo colaboraciones para target_user=%s",
                target_user.user,
            )
            collab_playlist_ids = set()

    # Colaboraciones del usuario de sesión (para canEdit)
    session_collab_ids = set()
    if session_user:
        try:
            session_collab_ids = set(
                PlaylistCollaborator.objects.filter(
                    user=session_user
                ).values_list("playlist_id", flat=True)
            )
        except Exception:
            logger.exception(
                "playlist_getAll: error leyendo colaboraciones para session_user=%s",
                session_user.user,
            )
            session_collab_ids = set()

    # Playlists visibles:
    #   - públicas para todos
    #   - del propio usuario (aunque sean privadas)
    #   - donde el usuario es colaborador (aunque sean privadas)
    try:
        if target_user:
            qs = PlayList.objects.filter(
                Q(isprivate=False)
                | Q(idUser=target_user.id)
                | Q(id__in=collab_playlist_ids)
            )
        else:
            qs = PlayList.objects.filter(isprivate=False)
    except Exception:
        logger.exception("playlist_getAll: error consultando PlayList")
        return JsonResponse([], safe=False)

    base = list(
        qs.values(
            "id",
            "idUser",
            "name",
            "portada",
            "isprivate",
            "created_at",
        )
    )
    if not base:
        return JsonResponse([], safe=False)

    playlist_ids = [p["id"] for p in base]

    # Likes por playlist
    try:
        ct = ContentType.objects.get_for_model(PlayList)
        likes_qs = LikeMedia.objects.filter(
            content_type=ct,
            object_id__in=playlist_ids,
        )
    except Exception:
        logger.exception("playlist_getAll: error consultando LikeMedia")
        likes_qs = LikeMedia.objects.none()

    counts = {}
    for l in likes_qs:
        counts[l.object_id] = counts.get(l.object_id, 0) + 1

    liked_ids = set()
    if session_user:
        try:
            liked_ids = set(
                likes_qs.filter(user=session_user).values_list(
                    "object_id",
                    flat=True,
                )
            )
        except Exception:
            logger.exception("playlist_getAll: error filtrando likes por session_user")
            liked_ids = set()

    # Mapa de dueños (idUser -> username)
    user_ids = {p["idUser"] for p in base if p.get("idUser")}
    try:
        owners = {
            u.id: u.user
            for u in Users.objects.filter(id__in=user_ids).only("id", "user")
        }
    except Exception:
        logger.exception("playlist_getAll: error obteniendo owners de playlists")
        owners = {}

    # Artistas seguidos por el usuario en sesión (para isfollow)
    followed_artist_ids = set()
    if session_user and user_ids:
        try:
            followed_artist_ids = set(
                FollowArtist.objects.filter(
                    follower=session_user,
                    artist_id__in=user_ids,
                ).values_list("artist_id", flat=True)
            )
        except Exception:
            logger.exception("playlist_getAll: error obteniendo FollowArtist")
            followed_artist_ids = set()

    for p in base:
        pid = p["id"]
        owner_id = p.get("idUser")

        p["likes_count"] = counts.get(pid, 0)
        p["liked"] = pid in liked_ids

        owner_username = owners.get(owner_id, "")
        p["owner_username"] = owner_username
        p["userCreated"] = owner_username  # usado por el frontend

        is_mine = bool(target_id is not None and owner_id == target_id)
        p["isMine"] = is_mine
        p["isPublic"] = not p["isprivate"]

        # ¿el usuario de referencia es colaborador de esta playlist?
        p["isCollaborator"] = pid in collab_playlist_ids

        # canEdit = dueño, admin o colaborador (para el session_user real)
        can_edit = False
        if session_user:
            if owner_id == session_user.id or _is_admin(session_user):
                can_edit = True
            elif pid in session_collab_ids:
                can_edit = True
        p["canEdit"] = can_edit

        # ¿el usuario en sesión sigue al creador de esta playlist?
        p["isfollow"] = bool(session_user and owner_id in followed_artist_ids)

    return JsonResponse(base, safe=False)


@require_GET
def playlist_getAllList(request):
    """
    Alias simple para mantener compatibilidad con el frontend
    (/playlist/getAllList/). Reutiliza playlist_getAll.
    """
    return playlist_getAll(request)


def sigue(seguidor_id: int, seguido_id: int) -> bool:
    """Helper genérico de seguimiento basado en FollowArtist."""
    try:
        return FollowArtist.objects.filter(
            follower_id=seguidor_id,
            artist_id=seguido_id,
        ).exists()
    except Exception:
        logger.exception("Error en sigue()")
        return False


@csrf_exempt
@require_http_methods(["POST"])
def setFollows(request):
    """
    Endpoint usado por el frontend para seguir/dejar de seguir
    al creador de una playlist.
    """
    seguidor_id = request.POST.get("seguidor_id")
    seguido_id = request.POST.get("seguido_id")
    action = (request.POST.get("action") or "").strip()  # 'follow' o 'unfollow'

    if not seguidor_id or not seguido_id:
        return JsonResponse({"error": "Faltan IDs"}, status=400)

    try:
        seguidor_id_int = int(seguidor_id)
        seguido_id_int = int(seguido_id)
    except ValueError:
        return JsonResponse({"error": "IDs inválidos"}, status=400)

    try:
        follower = Users.objects.get(id=seguidor_id_int)
        artist = Users.objects.get(id=seguido_id_int)
    except Users.DoesNotExist:
        return JsonResponse({"error": "Usuario no encontrado"}, status=404)

    if action == "unfollow":
        FollowArtist.objects.filter(
            follower=follower,
            artist=artist,
        ).delete()
        return JsonResponse({"followed": False})

    FollowArtist.objects.get_or_create(
        follower=follower,
        artist=artist,
    )
    return JsonResponse({"followed": True})


@csrf_exempt
@require_http_methods(["POST"])
def create_playlist(request):
    """
    Crea una playlist asociada a un usuario a partir de JSON.

    JSON esperado:
    {
      "user": "<username>",
      "name": "<nombre de la playlist>"
    }
    """
    try:
        data = json.loads(request.body)
        username = data.get("user")
        playlist_name = data.get("name")

        if not username or not playlist_name:
            return JsonResponse({"error": "Faltan campos: user y name"}, status=400)

        try:
            user_obj = Users.objects.get(user=username)
        except Users.DoesNotExist:
            return JsonResponse({"error": "Usuario no encontrado"}, status=404)

        new_playlist = PlayList(
            idUser=user_obj.id,
            name=playlist_name.strip(),
            portada="",
            isprivate=False,
        )
        new_playlist.save()

        return JsonResponse(
            {
                "message": "Playlist creada exitosamente",
                "playlist_id": new_playlist.id,
            },
            status=201,
        )

    except json.JSONDecodeError:
        return JsonResponse({"error": "JSON inválido"}, status=400)
    except Exception:
        logger.exception("Error en create_playlist")
        return JsonResponse({"error": "Error interno del servidor"}, status=500)


@require_http_methods(["GET"])
def get_songs_by_playlist(request, playlist_id):
    """
    Devuelve las canciones de una playlist en el orden definido en PlayListSong.

    Respuesta:
      { "songs": [ { id, title, artist_display_name, genre, audioUrl, coverUrl,
                     likes_count, liked } ] }
    """
    try:
        logger.info("Buscando canciones para playlist_id=%s", playlist_id)

        playlist_songs = PlayListSong.objects.filter(
            playlist_id=playlist_id
        ).order_by("position")

        if not playlist_songs.exists():
            logger.warning(
                "No se encontraron canciones para playlist_id=%s",
                playlist_id,
            )
            return JsonResponse({"songs": []})

        song_ids = [ps.song_id for ps in playlist_songs]
        logger.info("song_ids encontrados: %s", song_ids)

        qs = Song.objects.filter(id__in=song_ids).only(
            "id",
            "title",
            "artist_display_name",
            "genre",
            "audio_file",
            "cover_image",
        )

        ct_song = ContentType.objects.get_for_model(Song)
        likes_qs = LikeMedia.objects.filter(
            content_type=ct_song,
            object_id__in=song_ids,
        )

        counts = {}
        for l in likes_qs:
            counts[l.object_id] = counts.get(l.object_id, 0) + 1

        user = _get_session_user_obj(request)
        user_liked_set = set()
        if user:
            user_liked_set = set(
                likes_qs.filter(user=user).values_list(
                    "object_id",
                    flat=True,
                )
            )

        songs_map = {}
        for s in qs:
            au = _song_audio_url(s)
            cu = _song_cover_url(s)
            songs_map[s.id] = {
                "id": s.id,
                "title": s.title,
                "artist_display_name": getattr(
                    s,
                    "artist_display_name",
                    "",
                )
                or "",
                "genre": getattr(s, "genre", "") or "",
                "audioUrl": au,
                "coverUrl": cu,
                "likes_count": counts.get(s.id, 0),
                "liked": s.id in user_liked_set,
            }

        ordered = []
        for sid in song_ids:
            data = songs_map.get(sid)
            if not data:
                logger.warning("Canción con id %s no existe en tabla Song", sid)
                continue
            if not data["audioUrl"]:
                logger.warning(
                    "Canción id %s sin audioUrl; no será reproducible",
                    sid,
                )
                continue
            ordered.append(data)

        return JsonResponse({"songs": ordered})

    except Exception as e:
        logger.error("Error en get_songs_by_playlist: %s", str(e), exc_info=True)
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@require_http_methods(["DELETE"])
def delete_playlist(request, playlist_id):
    """Elimina una playlist por identificador (owner o admin)."""
    try:
        session_user = _get_session_user_obj(request)
        if not session_user:
            return JsonResponse({"error": "login_required"}, status=401)

        pl = get_object_or_404(PlayList, id=playlist_id)

        is_owner = getattr(pl, "idUser", None) == getattr(session_user, "id", None)
        if not (is_owner or _is_admin(session_user)):
            return JsonResponse({"error": "forbidden"}, status=403)

        pl.delete()
        return JsonResponse(
            {"message": "Playlist eliminada correctamente"},
            status=200,
        )

    except PlayList.DoesNotExist:
        return JsonResponse({"error": "Playlist no encontrada"}, status=404)
    except Exception:
        logger.exception("Error en delete_playlist")
        return JsonResponse({"error": "Error interno del servidor"}, status=500)


@csrf_exempt
@require_http_methods(["PUT"])
def update_playlist(request, playlist_id):
    """
    Actualiza nombre y/o privacidad de una playlist desde JSON.

    Permisos:
    - Nombre: owner, admin o colaborador.
    - isprivate: sólo owner o admin (los colaboradores no cambian visibilidad).
    """
    try:
        session_user = _get_session_user_obj(request)
        if not session_user:
            return JsonResponse({"error": "login_required"}, status=401)

        pl = PlayList.objects.get(id=playlist_id)

        try:
            data = json.loads(request.body or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"error": "JSON inválido"}, status=400)

        # --- Nombre ---
        new_name = data.get("name", None)
        if new_name is not None:
            if not _user_can_edit_playlist(session_user, pl):
                return JsonResponse({"error": "forbidden"}, status=403)

            new_name = (new_name or "").strip()
            if not new_name:
                return JsonResponse(
                    {"error": "El nombre no puede estar vacío"},
                    status=400,
                )
            pl.name = new_name

        # --- Privacidad ---
        if "isprivate" in data:
            is_owner = getattr(pl, "idUser", None) == getattr(session_user, "id", None)
            if not (is_owner or _is_admin(session_user)):
                return JsonResponse({"error": "forbidden"}, status=403)

            ispriv = bool(data.get("isprivate"))
            pl.isprivate = ispriv

        pl.save()
        return JsonResponse(
            {
                "message": "Playlist actualizada",
                "name": pl.name,
                "isprivate": pl.isprivate,
            },
            status=200,
        )

    except PlayList.DoesNotExist:
        return JsonResponse({"error": "Playlist no encontrada"}, status=404)
    except Exception:
        logger.exception("Error en update_playlist")
        return JsonResponse({"error": "Error interno del servidor"}, status=500)


@require_http_methods(["GET"])
def get_all_songs(request):
    """
    Devuelve canciones públicas para Home / reproductor en orden reciente.

    Forma de cada elemento:
      { id, title, artist_display_name, genre, audioUrl, coverUrl }
    """
    try:
        qs = (
            Song.objects.filter(visibility="public")
            .only(
                "id",
                "title",
                "artist_display_name",
                "genre",
                "audio_file",
                "cover_image",
                "created_at",
            )
            .order_by("-created_at")
        )

        songs = []
        for s in qs:
            au = _song_audio_url(s)
            if not au:
                continue

            songs.append(
                {
                    "id": s.id,
                    "title": s.title,
                    "artist_display_name": getattr(
                        s,
                        "artist_display_name",
                        "",
                    )
                    or "",
                    "genre": getattr(s, "genre", "") or "",
                    "audioUrl": au,
                    "coverUrl": _song_cover_url(s),
                }
            )

        return JsonResponse(songs, safe=False)

    except Exception:
        logger.exception("Error en get_all_songs")
        return JsonResponse({"error": "Error interno del servidor"}, status=500)


@require_http_methods(["GET"])
def mis_likes_json(request):
    """
    Devuelve las canciones marcadas con like por el usuario autenticado.

    Respuesta:
      { id: "pl:likes", name: "Mis likes", songs: [...] }
    """
    user = _get_session_user_obj(request)
    if not user:
        return JsonResponse({"error": "login_required"}, status=401)

    ct_song = ContentType.objects.get_for_model(Song)
    like_qs = LikeMedia.objects.filter(
        user=user,
        content_type=ct_song,
    ).values_list("object_id", flat=True)

    songs_qs = (
        Song.objects.filter(id__in=list(like_qs), visibility="public")
        .only(
            "id",
            "title",
            "artist_display_name",
            "genre",
            "audio_file",
            "cover_image",
        )
        .order_by("-created_at")
    )

    songs = []
    for s in songs_qs:
        au = _song_audio_url(s)
        if not au:
            continue
        songs.append(
            {
                "id": s.id,
                "title": s.title,
                "artist_display_name": getattr(
                    s,
                    "artist_display_name",
                    "",
                )
                or "",
                "genre": getattr(s, "genre", "") or "",
                "audioUrl": au,
                "coverUrl": _song_cover_url(s),
            }
        )

    return JsonResponse({"id": "pl:likes", "name": "Mis likes", "songs": songs})


@require_http_methods(["GET"])
def followed_artists_playlists_json(request):
    """
    Devuelve playlists virtuales por cada artista que el usuario sigue.

    Cada playlist es: canciones públicas (visibility='public') de ese artista.
    """
    user = _get_session_user_obj(request)
    if not user:
        return JsonResponse({"error": "login_required"}, status=401)

    # Artistas que sigue el usuario actual
    followed = FollowArtist.objects.filter(follower=user).select_related("artist")
    artist_users = [fa.artist for fa in followed]

    if not artist_users:
        return JsonResponse({"playlists": []})

    # Usuarios-artista -> username (cadena) para filtrar Song.owner_user
    artist_usernames = [a.user for a in artist_users]

    qs = (
        Song.objects.filter(
            owner_user__in=artist_usernames,
            visibility="public",
        )
        .only(
            "id",
            "title",
            "artist_display_name",
            "genre",
            "audio_file",
            "cover_image",
        )
        .order_by("id")
    )

    # Agrupar canciones por owner_user (username del artista)
    songs_by_artist = {}
    for s in qs:
        au = _song_audio_url(s)
        if not au:
            continue

        key = getattr(s, "owner_user", "")
        if not key:
            continue

        songs_by_artist.setdefault(key, []).append(
            {
                "id": s.id,
                "title": s.title,
                "artist_display_name": getattr(
                    s,
                    "artist_display_name",
                    "",
                )
                or "",
                "genre": getattr(s, "genre", "") or "",
                "audioUrl": au,
                "coverUrl": _song_cover_url(s),
            }
        )

    playlists = []
    for artist_user in artist_users:
        uname = artist_user.user
        songs = songs_by_artist.get(uname, [])
        if not songs:
            continue

        playlists.append(
            {
                "id": f"artist:{uname}",
                "artist_username": uname,
                "artist_display_name": uname,
                "name": uname,
                "songs": songs,
            }
        )

    return JsonResponse({"playlists": playlists})


@csrf_exempt
@require_http_methods(["POST"])
def add_song_to_playlist(request):
    """
    Agrega una canción a una playlist a partir de JSON.

    Permisos: owner, admin o colaborador.

    JSON esperado:
      { "song_id": <int>, "playlist_id": <int>, "position": <int> }
    """
    try:
        session_user = _get_session_user_obj(request)
        if not session_user:
            return JsonResponse({"error": "login_required"}, status=401)

        data = json.loads(request.body)
        song_id = data.get("song_id")
        playlist_id = data.get("playlist_id")
        position = data.get("position")

        if song_id is None or playlist_id is None or position is None:
            return JsonResponse(
                {"error": "Faltan parámetros: song_id, playlist_id, position"},
                status=400,
            )

        try:
            pl = PlayList.objects.get(id=playlist_id)
        except PlayList.DoesNotExist:
            return JsonResponse({"error": "Playlist no encontrada"}, status=404)

        if not _user_can_edit_playlist(session_user, pl):
            return JsonResponse({"error": "forbidden"}, status=403)

        PlayListSong.objects.create(
            playlist_id=playlist_id,
            song_id=song_id,
            position=position,
        )

        return JsonResponse(
            {"message": "Canción agregada a la playlist", "position": position},
            status=201,
        )

    except json.JSONDecodeError:
        return JsonResponse({"error": "JSON inválido"}, status=400)
    except Exception:
        logger.exception("Error en add_song_to_playlist")
        return JsonResponse({"error": "Error interno del servidor"}, status=500)


@csrf_exempt
@require_http_methods(["DELETE"])
def remove_song_from_playlist(request):
    """
    Elimina una canción de una playlist a partir de JSON.

    Permisos: owner, admin o colaborador.

    JSON esperado:
      { "playlist_id": <int>, "song_id": <int> }
    """
    try:
        session_user = _get_session_user_obj(request)
        if not session_user:
            return JsonResponse({"error": "login_required"}, status=401)

        data = json.loads(request.body)
        playlist_id = data.get("playlist_id")
        song_id = data.get("song_id")

        if playlist_id is None or song_id is None:
            return JsonResponse(
                {"error": "Se requieren playlist_id y song_id"},
                status=400,
            )

        try:
            pl = PlayList.objects.get(id=playlist_id)
        except PlayList.DoesNotExist:
            return JsonResponse({"error": "Playlist no encontrada"}, status=404)

        if not _user_can_edit_playlist(session_user, pl):
            return JsonResponse({"error": "forbidden"}, status=403)

        deleted_count, _ = PlayListSong.objects.filter(
            playlist_id=playlist_id,
            song_id=song_id,
        ).delete()

        if deleted_count == 0:
            return JsonResponse({"error": "Registro no encontrado"}, status=404)

        return JsonResponse(
            {"message": "Canción eliminada de la playlist"},
            status=200,
        )

    except json.JSONDecodeError:
        return JsonResponse({"error": "JSON inválido"}, status=400)
    except Exception:
        logger.exception("Error en remove_song_from_playlist")
        return JsonResponse({"error": "Error interno del servidor"}, status=500)


# ======================================================================
# Búsqueda (HTML + API JSON)
# ======================================================================


def buscar(request):
    """
    Vista HTML de búsqueda (canciones públicas, artistas y playlists públicas).

    Requiere sesión activa.
    """
    if "user" not in request.session:
        messages.error(request, "Debes iniciar sesión para acceder a esta página.")
        return redirect("login")

    query = request.GET.get("q", "").strip()
    resultados = {"canciones": [], "artistas": [], "playlists": []}

    if query:
        resultados["canciones"] = (
            Song.objects.filter(
                Q(title__icontains=query)
                | Q(artist_display_name__icontains=query),
                visibility="public",
            )
            .only(
                "id",
                "title",
                "artist_display_name",
                "audio_file",
                "cover_image",
                "genre",
            )[:20]
        )

        resultados["artistas"] = (
            Users.objects.filter(
                Q(user__icontains=query) & Q(type__iexact="artista")
            )
            .only("id", "user", "avatar", "created_at")[:20]
        )

        resultados["playlists"] = (
            PlayList.objects.filter(
                Q(name__icontains=query) & Q(isprivate=False)
            )
            .only("id", "idUser", "name", "portada", "isprivate", "created_at")[:20]
        )

    session_user = request.session.get("user", "")
    session_role = request.session.get("role", "")

    avatar_url = ""
    try:
        u = Users.objects.get(user=session_user)
        if getattr(u, "avatar", None):
            avatar_url = _safe_file_url(u.avatar)
    except Users.DoesNotExist:
        pass

    ctx = {
        "query": query,
        "resultados": resultados,
        "session_user": session_user,
        "session_role": session_role,
        "session_avatar_url": avatar_url,
        "has_results": any(len(v) > 0 for v in resultados.values()),
    }
    return render(request, "inicio_sesion/buscar.html", ctx)


def api_buscar(request):
    """
    API JSON para autosuggest de búsqueda (canciones, artistas, playlists).

    Devuelve hasta 5 resultados por tipo si la query tiene al menos 2 caracteres.
    """
    query = request.GET.get("q", "").strip()

    if len(query) < 2:
        return JsonResponse({"canciones": [], "artistas": [], "playlists": []})

    results = {"canciones": [], "artistas": [], "playlists": []}

    try:
        canciones = Song.objects.filter(
            Q(title__icontains=query) | Q(artist_display_name__icontains=query),
            visibility="public",
        )[:5]
        for c in canciones:
            results["canciones"].append(
                {
                    "id": c.id,
                    "title": c.title,
                    "artist": c.artist_display_name,
                    "audioUrl": _song_audio_url(c),
                    "coverUrl": _song_cover_url(c),
                }
            )

        artistas = Users.objects.filter(
            Q(user__icontains=query) & Q(type__iexact="artista")
        )[:5]
        for a in artistas:
            results["artistas"].append(
                {
                    "id": a.id,
                    "username": a.user,
                    "avatarUrl": _safe_file_url(a.avatar),
                }
            )

        playlists = PlayList.objects.filter(
            Q(name__icontains=query) & Q(isprivate=False)
        )[:5]
        for p in playlists:
            results["playlists"].append(
                {
                    "id": p.id,
                    "name": p.name,
                    "coverUrl": p.portada,
                }
            )

    except Exception as e:
        logger.error("Error en api_buscar: %s", str(e))

    return JsonResponse(results)


# ======================================================================
# Likes (canciones / playlists)
# ======================================================================


@require_POST
def like_song(request, song_id):
    """
    Alterna el estado de like para una canción y devuelve conteo total.

    Respuesta:
      { liked: bool, total: int }
    """
    user = _get_session_user_obj(request)
    if not user:
        return JsonResponse({"error": "login_required"}, status=401)

    song = get_object_or_404(Song, id=song_id)
    ct = ContentType.objects.get_for_model(Song)

    qs = LikeMedia.objects.filter(
        user=user,
        content_type=ct,
        object_id=song.id,
    )
    if qs.exists():
        qs.delete()
        liked = False
    else:
        LikeMedia.objects.create(
            user=user,
            content_type=ct,
            object_id=song.id,
        )
        liked = True

    total = LikeMedia.objects.filter(content_type=ct, object_id=song.id).count()
    return JsonResponse({"liked": liked, "total": total})


@require_POST
def like_playlist(request, playlist_id):
    """
    Alterna el estado de like para una playlist y devuelve conteo total.

    Respuesta:
      { liked: bool, total: int }
    """
    user = _get_session_user_obj(request)
    if not user:
        return JsonResponse({"error": "login_required"}, status=401)

    playlist = get_object_or_404(PlayList, id=playlist_id)
    ct = ContentType.objects.get_for_model(PlayList)

    qs = LikeMedia.objects.filter(
        user=user,
        content_type=ct,
        object_id=playlist.id,
    )
    if qs.exists():
        qs.delete()
        liked = False
    else:
        LikeMedia.objects.create(
            user=user,
            content_type=ct,
            object_id=playlist.id,
        )
        liked = True

    total = LikeMedia.objects.filter(content_type=ct, object_id=playlist.id).count()
    return JsonResponse({"liked": liked, "total": total})


# ======================================================================
# Colaboradores (playlists)
# ======================================================================


@require_http_methods(["GET"])
def playlist_collaborators_list(request, playlist_id):
    """
    Devuelve la lista de colaboradores de una playlist (solo owner o admin).

    Usa PlaylistCollaborator (playlist_id + user FK).
    """
    session_user = _get_session_user_obj(request)
    pl = get_object_or_404(PlayList, id=playlist_id)

    if not session_user:
        return JsonResponse({"error": "login_required"}, status=401)

    is_owner = (
        pl.idUser == session_user.id
        if getattr(session_user, "id", None) is not None
        else False
    )
    is_admin = _is_admin(session_user)
    if not (is_owner or is_admin):
        return JsonResponse({"error": "forbidden"}, status=403)

    cols = PlaylistCollaborator.objects.filter(
        playlist_id=playlist_id
    ).select_related("user")

    result = []
    for c in cols:
        u = c.user
        result.append(
            {
                "user_id": u.id if u else None,
                "username": u.user if u else "",
                "role": c.role,
                "added_at": c.created_at.isoformat(),
            }
        )

    return JsonResponse({"collaborators": result})


@require_POST
def playlist_collaborator_add(request, playlist_id):
    """
    Añade un colaborador (username) a una playlist (solo owner o admin).

    Guarda playlist_id + user (FK) + role.
    """
    session_user = _get_session_user_obj(request)
    if not session_user:
        return JsonResponse({"error": "login_required"}, status=401)

    pl = get_object_or_404(PlayList, id=playlist_id)
    is_owner = (
        pl.idUser == session_user.id
        if getattr(session_user, "id", None) is not None
        else False
    )
    is_admin = _is_admin(session_user)
    if not (is_owner or is_admin):
        return JsonResponse({"error": "forbidden"}, status=403)

    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except Exception:
        data = {}

    username = (data.get("username") or "").strip()
    if not username:
        return JsonResponse({"error": "username_required"}, status=400)

    role = (data.get("role") or "").strip() or "viewer"
    if role not in ("viewer", "editor"):
        role = "viewer"

    try:
        target = Users.objects.get(user=username)
    except Users.DoesNotExist:
        return JsonResponse({"error": "user_not_found"}, status=404)

    try:
        col, created = PlaylistCollaborator.objects.get_or_create(
            playlist_id=playlist_id,
            user=target,
            defaults={"role": role},
        )
        if not created and col.role != role:
            col.role = role
            col.save(update_fields=["role"])

        return JsonResponse(
            {
                "added": True,
                "user_id": target.id,
                "username": target.user,
                "role": col.role,
                "created": created,
            }
        )
    except IntegrityError:
        return JsonResponse({"error": "db_error"}, status=500)


@require_http_methods(["DELETE"])
def playlist_collaborator_remove(request, playlist_id, user_id):
    """
    Elimina la colaboración de un usuario en una playlist (solo owner o admin).

    user_id es el ID en Users.
    """
    session_user = _get_session_user_obj(request)
    if not session_user:
        return JsonResponse({"error": "login_required"}, status=401)

    pl = get_object_or_404(PlayList, id=playlist_id)
    is_owner = (
        pl.idUser == session_user.id
        if getattr(session_user, "id", None) is not None
        else False
    )
    is_admin = _is_admin(session_user)
    if not (is_owner or is_admin):
        return JsonResponse({"error": "forbidden"}, status=403)

    try:
        target = Users.objects.get(id=user_id)
    except Users.DoesNotExist:
        return JsonResponse({"error": "user_not_found"}, status=404)

    deleted, _ = PlaylistCollaborator.objects.filter(
        playlist_id=playlist_id,
        user=target,
    ).delete()

    if deleted:
        return JsonResponse({"removed": True})
    return JsonResponse({"removed": False, "error": "not_found"}, status=404)

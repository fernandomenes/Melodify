import json
import logging

from django.contrib import messages
from django.contrib.auth import logout as django_logout
from django.contrib.contenttypes.models import ContentType
from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.csrf import csrf_exempt, csrf_protect
from django.views.decorators.http import require_http_methods, require_POST

from .models import ArtistProfile, LikeMedia, PlayList, PlayListSong, Song, Users

logger = logging.getLogger(__name__)


# ============================================================================
# Helpers genéricos
# ============================================================================


def _safe_file_url(f):
    """
    Devuelve una URL segura para un FileField/ImageField.

    - Si el archivo no tiene nombre o no es accesible, retorna cadena vacía.
    - Evita excepciones en plantillas o al serializar a JSON.
    """
    if not f:
        return ""
    try:
        return f.url if getattr(f, "name", "") else ""
    except Exception:
        # Fallback muy defensivo
        try:
            return str(f)
        except Exception:
            return ""


def _song_audio_url(song):
    """
    Devuelve la URL de audio de una instancia Song o cadena vacía.
    """
    return _safe_file_url(getattr(song, "audio_file", None)) or ""


def _song_cover_url(song):
    """
    Devuelve la URL de portada de una instancia Song o None.
    """
    cover = _safe_file_url(getattr(song, "cover_image", None))
    return cover or None


def _get_session_user_obj(request):
    """
    Devuelve la instancia Users asociada a request.session['user'],
    o None si no existe.
    """
    username = request.session.get("user")
    if not username:
        return None
    try:
        return Users.objects.get(user=username)
    except Users.DoesNotExist:
        return None


# ============================================================================
# Pantallas básicas (pública / autenticación / home)
# ============================================================================


def pantallaPrincipal(request):
    """Renderiza la pantalla pública principal."""
    return render(request, "inicio_sesion/principal.html")


def pantallaHome(request):
    """
    Renderiza la pantalla principal autenticada (Home SPA).

    Incluye en el contexto:
    - Información de la sesión actual:
        * session_user, session_role, avatar, descripción y fecha de creación.
    - Para usuarios con rol "artista", una playlist virtual “Mi música”
      con sus canciones públicas, enviada en playlists_json (JSON).
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

    # Datos del usuario en sesión (avatar, fecha, descripción de artista)
    try:
        u = Users.objects.get(user=session_user)

        if getattr(u, "avatar", None):
            avatar_url = _safe_file_url(u.avatar)

        if getattr(u, "created_at", None):
            created_at_str = u.created_at.strftime("%Y-%m-%d %H:%M")

        if role_lower == "artista":
            # Puede no existir el ArtistProfile
            try:
                artist_description = (u.artist_profile.description or "").strip()
            except ArtistProfile.DoesNotExist:
                artist_description = ""
    except Users.DoesNotExist:
        # Usuario de sesión inconsistente: dejamos campos vacíos
        pass

    # Playlist virtual “Mi música” (solo para rol artista)
    playlists = []
    if role_lower == "artista":
        qs = (
            Song.objects.filter(owner_user=session_user, visibility="public")
            .only(
                "id",
                "title",
                "artist_display_name",
                "audio_file",
                "cover_image",
                "genre",
            )
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
    Pantalla de registro de usuarios (modelo Users).

    Nota: actualmente almacena la contraseña en texto plano.
    (no se usa auth de Django, se respeta la implementación existente).
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
            except Exception as e:
                logger.exception("Error al crear usuario en pantallaRegistro")
                errors.append(f"Error al crear el usuario: {str(e)}")

        for error in errors:
            messages.error(request, error)

    return render(request, "inicio_sesion/registro.html")


@require_http_methods(["GET", "POST"])
@csrf_protect
def pantallaLogout(request):
    """
    Cierra la sesión del usuario y deshabilita el caché de la página anterior.

    - Limpia la sesión (request.session.flush()).
    - Ejecuta logout de Django.
    - Redirige a login con cabeceras anti-cache.
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
    Inicio de sesión utilizando el modelo Users.

    Al autenticar correctamente:
    - Regenera la clave de sesión.
    - Limpia claves de estado temporal (undo, etc.).
    - Almacena usuario y rol en la sesión.
    """
    if request.method == "POST":
        user = request.POST.get("user")
        password = request.POST.get("password")

        try:
            usuario_db = Users.objects.get(user=user, password=password)

            # Regenerar sesión y limpiar estados temporales
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


# ============================================================================
# Playlists (API JSON usada por la SPA y buscador)
# ============================================================================


def playlist_getAll(request):
    """
    Devuelve todas las playlists con información de likes.

    Respuesta: lista JSON de playlists con campos:
        - id
        - idUser
        - name
        - portada
        - isprivate
        - created_at
        - likes_count: número total de likes
        - liked: si el usuario actual le ha dado like
    """
    user = _get_session_user_obj(request)

    base = list(
        PlayList.objects.values(
            "id", "idUser", "name", "portada", "isprivate", "created_at"
        )
    )
    if not base:
        return JsonResponse([], safe=False)

    playlist_ids = [p["id"] for p in base]

    ct = ContentType.objects.get_for_model(PlayList)
    likes_qs = LikeMedia.objects.filter(
        content_type=ct,
        object_id__in=playlist_ids,
    )

    # Conteo de likes por playlist
    counts = {}
    for l in likes_qs:
        counts[l.object_id] = counts.get(l.object_id, 0) + 1

    # Conjunto de playlists que el usuario actual ha likeado
    user_liked_ids = set()
    if user:
        user_liked_ids = set(
            likes_qs.filter(user=user).values_list("object_id", flat=True)
        )

    # Inyectar metadata en la lista base
    for p in base:
        pid = p["id"]
        p["likes_count"] = counts.get(pid, 0)
        p["liked"] = pid in user_liked_ids

    return JsonResponse(base, safe=False)


@csrf_exempt
@require_http_methods(["POST"])
def create_playlist(request):
    """
    Crea una playlist asociada a un usuario a partir de un cuerpo JSON.

    Espera JSON:
        { "user": "<username>", "name": "<nombre playlist>" }
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
    except Exception as e:
        logger.exception("Error en create_playlist")
        return JsonResponse({"error": str(e)}, status=500)


@require_http_methods(["GET"])
def get_songs_by_playlist(request, playlist_id):
    """
    Devuelve las canciones asociadas a una playlist en el orden definido
    en la tabla intermedia PlayListSong.

    Formato de respuesta:
        {
            "songs": [
                {
                    "id": ...,
                    "title": "...",
                    "artist_display_name": "...",
                    "genre": "...",
                    "audioUrl": "...",
                    "coverUrl": "... | null",
                    "likes_count": int,
                    "liked": bool
                },
                ...
            ]
        }
    """
    try:
        logger.info("Buscando canciones para playlist_id=%s", playlist_id)

        playlist_songs = PlayListSong.objects.filter(
            playlist_id=playlist_id
        ).order_by("position")

        if not playlist_songs.exists():
            logger.warning("No se encontraron canciones para playlist_id=%s", playlist_id)
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

        # --- Likes para estas canciones ---
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
                likes_qs.filter(user=user).values_list("object_id", flat=True)
            )

        # Mapa de canciones por id con info extra
        songs_map = {}
        for s in qs:
            au = _song_audio_url(s)
            cu = _song_cover_url(s)
            songs_map[s.id] = {
                "id": s.id,
                "title": s.title,
                "artist_display_name": getattr(s, "artist_display_name", "") or "",
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
                    "Canción id %s sin audioUrl; no será reproducible", sid
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
    """
    Elimina una playlist por identificador.

    Respuesta:
        200 -> { "message": "Playlist eliminada correctamente" }
        404 -> { "error": "Playlist no encontrada" }
    """
    try:
        playlist = PlayList.objects.get(id=playlist_id)
        playlist.delete()
        return JsonResponse({"message": "Playlist eliminada correctamente"}, status=200)

    except PlayList.DoesNotExist:
        return JsonResponse({"error": "Playlist no encontrada"}, status=404)
    except Exception as e:
        logger.exception("Error en delete_playlist")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@require_http_methods(["PUT"])
def update_playlist(request, playlist_id):
    """
    Actualiza el nombre de una playlist a partir de un cuerpo JSON.

    Espera JSON:
        { "name": "<nuevo nombre>" }
    """
    try:
        playlist = PlayList.objects.get(id=playlist_id)
        data = json.loads(request.body)
        new_name = (data.get("name") or "").strip()

        if not new_name:
            return JsonResponse({"error": "El nombre no puede estar vacío"}, status=400)

        playlist.name = new_name
        playlist.save()

        return JsonResponse(
            {"message": "Playlist actualizada correctamente", "name": playlist.name},
            status=200,
        )

    except PlayList.DoesNotExist:
        return JsonResponse({"error": "Playlist no encontrada"}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({"error": "JSON inválido"}, status=400)
    except Exception as e:
        logger.exception("Error en update_playlist")
        return JsonResponse({"error": str(e)}, status=500)


@require_http_methods(["GET"])
def get_all_songs(request):
    """
    Devuelve un listado de canciones públicas para el Home / reproductor.

    Cada canción:
        {
            "id": ...,
            "title": "...",
            "artist_display_name": "...",
            "genre": "...",
            "audioUrl": "...",
            "coverUrl": "..." | null
        }
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
                # Si no tiene audio reproducible, no la mostramos
                continue

            songs.append(
                {
                    "id": s.id,
                    "title": s.title,
                    "artist_display_name": getattr(
                        s, "artist_display_name", ""
                    )
                    or "",
                    "genre": getattr(s, "genre", "") or "",
                    "audioUrl": au,
                    "coverUrl": _song_cover_url(s),
                }
            )

        return JsonResponse(songs, safe=False)

    except Exception as e:
        logger.exception("Error en get_all_songs")
        return JsonResponse({"error": str(e)}, status=500)


@require_http_methods(["GET"])
def mis_likes_json(request):
    """
    Devuelve las canciones marcadas con "like" por el usuario autenticado,
    en el formato esperado por el reproductor.

    Respuesta:
        {
            "id": "pl:likes",
            "name": "Mis likes",
            "songs": [ ... ]
        }
    """
    user = _get_session_user_obj(request)
    if not user:
        return JsonResponse({"error": "login_required"}, status=401)

    ct_song = ContentType.objects.get_for_model(Song)
    like_qs = LikeMedia.objects.filter(
        user=user, content_type=ct_song
    ).values_list("object_id", flat=True)

    songs_qs = (
        Song.objects.filter(id__in=list(like_qs), visibility="public")
        .only("id", "title", "artist_display_name", "genre", "audio_file", "cover_image")
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
                    s, "artist_display_name", ""
                )
                or "",
                "genre": getattr(s, "genre", "") or "",
                "audioUrl": au,
                "coverUrl": _song_cover_url(s),
            }
        )

    return JsonResponse({"id": "pl:likes", "name": "Mis likes", "songs": songs})


@csrf_exempt
@require_http_methods(["POST"])
def add_song_to_playlist(request):
    """
    Agrega una canción a una playlist a partir de un cuerpo JSON.

    Espera JSON:
        {
            "song_id": <id canción>,
            "playlist_id": <id playlist>,
            "position": <posición entera>
        }
    """
    try:
        data = json.loads(request.body)
        song_id = data.get("song_id")
        playlist_id = data.get("playlist_id")
        position = data.get("position")

        if song_id is None or playlist_id is None or position is None:
            return JsonResponse(
                {"error": "Faltan parámetros: song_id, playlist_id, position"},
                status=400,
            )

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
    except Exception as e:
        logger.exception("Error en add_song_to_playlist")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@require_http_methods(["DELETE"])
def remove_song_from_playlist(request):
    """
    Elimina una canción de una playlist a partir de un cuerpo JSON.

    Espera JSON:
        {
            "playlist_id": <id playlist>,
            "song_id": <id canción>
        }
    """
    try:
        data = json.loads(request.body)
        playlist_id = data.get("playlist_id")
        song_id = data.get("song_id")

        if playlist_id is None or song_id is None:
            return JsonResponse(
                {"error": "Se requieren playlist_id y song_id"}, status=400
            )

        deleted_count, _ = PlayListSong.objects.filter(
            playlist_id=playlist_id, song_id=song_id
        ).delete()

        if deleted_count == 0:
            return JsonResponse({"error": "Registro no encontrado"}, status=404)

        return JsonResponse(
            {"message": "Canción eliminada de la playlist"}, status=200
        )

    except json.JSONDecodeError:
        return JsonResponse({"error": "JSON inválido"}, status=400)
    except Exception as e:
        logger.exception("Error en remove_song_from_playlist")
        return JsonResponse({"error": str(e)}, status=500)


# ============================================================================
# Búsqueda (HTML + API JSON)
# ============================================================================


def buscar(request):
    """
    Vista HTML de búsqueda (página /buscar/).

    Busca en:
    - Canciones públicas (Song)
    - Artistas (Users con type='artista')
    - Playlists públicas (PlayList)

    Requiere que el usuario haya iniciado sesión.
    """
    if "user" not in request.session:
        messages.error(request, "Debes iniciar sesión para acceder a esta página.")
        return redirect("login")

    query = request.GET.get("q", "").strip()
    resultados = {"canciones": [], "artistas": [], "playlists": []}

    if query:
        # Canciones públicas
        resultados["canciones"] = (
            Song.objects.filter(
                Q(title__icontains=query) | Q(artist_display_name__icontains=query),
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

        # Artistas
        resultados["artistas"] = (
            Users.objects.filter(
                Q(user__icontains=query) & Q(type__iexact="artista")
            )
            .only("id", "user", "avatar", "created_at")[:20]
        )

        # Playlists públicas
        resultados["playlists"] = (
            PlayList.objects.filter(Q(name__icontains=query) & Q(isprivate=False))
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
    API JSON para búsqueda en tiempo real (autosuggest).

    Devuelve hasta 5 coincidencias por tipo:
    - canciones (públicas)
    - artistas (Users type='artista')
    - playlists (públicas)
    """
    query = request.GET.get("q", "").strip()

    if len(query) < 2:
        return JsonResponse({"canciones": [], "artistas": [], "playlists": []})

    results = {"canciones": [], "artistas": [], "playlists": []}

    try:
        # Canciones
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

        # Artistas
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

        # Playlists públicas
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


# ============================================================================
# Likes (canciones / playlists)
# ============================================================================


@require_POST
def like_song(request, song_id):
    """
    Alterna el estado de "like" para una canción.

    Respuesta JSON:
        { "liked": bool, "total": int }
    """
    user = _get_session_user_obj(request)
    if not user:
        return JsonResponse({"error": "login_required"}, status=401)

    song = get_object_or_404(Song, id=song_id)
    ct = ContentType.objects.get_for_model(Song)

    qs = LikeMedia.objects.filter(user=user, content_type=ct, object_id=song.id)
    if qs.exists():
        qs.delete()
        liked = False
    else:
        LikeMedia.objects.create(user=user, content_type=ct, object_id=song.id)
        liked = True

    total = LikeMedia.objects.filter(content_type=ct, object_id=song.id).count()
    return JsonResponse({"liked": liked, "total": total})


@require_POST
def like_playlist(request, playlist_id):
    """
    Alterna el estado de "like" para una playlist.

    Respuesta JSON:
        { "liked": bool, "total": int }
    """
    user = _get_session_user_obj(request)
    if not user:
        return JsonResponse({"error": "login_required"}, status=401)

    playlist = get_object_or_404(PlayList, id=playlist_id)
    ct = ContentType.objects.get_for_model(PlayList)

    qs = LikeMedia.objects.filter(user=user, content_type=ct, object_id=playlist.id)
    if qs.exists():
        qs.delete()
        liked = False
    else:
        LikeMedia.objects.create(user=user, content_type=ct, object_id=playlist.id)
        liked = True

    total = LikeMedia.objects.filter(content_type=ct, object_id=playlist.id).count()
    return JsonResponse({"liked": liked, "total": total})

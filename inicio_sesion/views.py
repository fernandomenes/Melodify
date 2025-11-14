import json
import logging

from django.contrib import messages
from django.db.models import Q
from django.contrib.auth import logout as django_logout
from django.http import JsonResponse
from django.shortcuts import redirect, render, get_object_or_404
from django.views.decorators.csrf import csrf_exempt, csrf_protect
from django.views.decorators.http import require_http_methods, require_POST
from django.contrib.contenttypes.models import ContentType

from .models import ArtistProfile, PlayList, PlayListSong, Song, Users, LikeMedia

logger = logging.getLogger(__name__)


def pantallaPrincipal(request):
    """Renderiza la pantalla pública principal."""
    return render(request, "inicio_sesion/principal.html")


def _safe_file_url(f):
    """
    Devuelve una URL segura para un FileField/ImageField.

    Si el archivo no tiene nombre o no es accesible, retorna una cadena vacía
    para evitar excepciones en plantillas o serialización.
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


def pantallaHome(request):
    """
    Renderiza la pantalla principal autenticada.

    Incluye:
    - Información de sesión del usuario (avatar, fecha de creación, descripción).
    - Para usuarios con rol de artista, una playlist virtual “Mi música” con sus canciones públicas.
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

    playlists = []
    if role_lower == "artista":
        qs = (
            Song.objects
            .filter(owner_user=session_user, visibility="public")
            .only("id", "title", "artist_display_name", "audio_file", "cover_image", "genre")
        )
        songs = [
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
        playlists.append({"id": 1, "name": "Mi música", "songs": songs})

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
    """Formulario de registro de usuarios."""
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
                messages.success(request, "¡Registro exitoso! Ahora puedes iniciar sesión.")
                return redirect("login")
            except Exception as e:
                errors.append(f"Error al crear el usuario: {str(e)}")

        for error in errors:
            messages.error(request, error)

    return render(request, "inicio_sesion/registro.html")


@require_http_methods(["GET", "POST"])
@csrf_protect
def pantallaLogout(request):
    """
    Cierra la sesión del usuario, limpia la información de sesión
    y deshabilita el caché del navegador para la página anterior.
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
    - Limpia claves de estado temporal (operaciones de deshacer).
    - Almacena usuario y rol en la sesión.
    """
    if request.method == "POST":
        user = request.POST.get("user")
        password = request.POST.get("password")
        try:
            usuario_db = Users.objects.get(user=user, password=password)
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


# ---------- Playlists (API JSON) ----------

def playlist_getAll(request):
    """Devuelve un listado plano de playlists en formato JSON."""
    data = list(
        PlayList.objects.values(
            "id", "idUser", "name", "portada", "isprivate", "created_at"
        )
    )
    return JsonResponse(data, safe=False)


@csrf_exempt
@require_http_methods(["POST"])
def create_playlist(request):
    """Crea una playlist asociada a un usuario a partir de un cuerpo JSON."""
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
            {"message": "Playlist creada exitosamente", "playlist_id": new_playlist.id},
            status=201,
        )

    except json.JSONDecodeError:
        return JsonResponse({"error": "JSON inválido"}, status=400)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


def get_songs_by_playlist(request, playlist_id):
    """
    Devuelve las canciones asociadas a una playlist en el orden definido
    en la tabla intermedia.

    Formato de cada canción:
        id, title, artist_display_name, genre, audioUrl, coverUrl
    """
    try:
        logger.info(f"Buscando canciones para playlist_id: {playlist_id}")

        playlist_songs = PlayListSong.objects.filter(
            playlist_id=playlist_id
        ).order_by("position")

        if not playlist_songs.exists():
            logger.warning(f"No se encontraron canciones para playlist_id={playlist_id}")
            return JsonResponse({"songs": []})

        song_ids = [ps.song_id for ps in playlist_songs]
        logger.info(f"song_ids encontrados: {song_ids}")

        qs = Song.objects.filter(id__in=song_ids).only(
            "id", "title", "artist_display_name", "genre", "audio_file", "cover_image"
        )

        def _audio_url(s):
            return _safe_file_url(getattr(s, "audio_file", None)) or ""

        def _cover_url(s):
            cu = _safe_file_url(getattr(s, "cover_image", None))
            return cu or None

        songs_map = {
            s.id: {
                "id": s.id,
                "title": s.title,
                "artist_display_name": getattr(s, "artist_display_name", "") or "",
                "genre": getattr(s, "genre", "") or "",
                "audioUrl": _audio_url(s),
                "coverUrl": _cover_url(s),
            }
            for s in qs
        }

        ordered = []
        for sid in song_ids:
            data = songs_map.get(sid)
            if not data:
                logger.warning(f"Canción con id {sid} no existe en tabla Song")
                continue
            if not data["audioUrl"]:
                logger.warning(f"Canción id {sid} sin audioUrl; no será reproducible")
                continue
            ordered.append(data)

        return JsonResponse({"songs": ordered})

    except Exception as e:
        logger.error(f"Error en get_songs_by_playlist: {str(e)}", exc_info=True)
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@require_http_methods(["DELETE"])
def delete_playlist(request, playlist_id):
    """Elimina una playlist por identificador."""
    try:
        playlist = PlayList.objects.get(id=playlist_id)
        playlist.delete()
        return JsonResponse({"message": "Playlist eliminada correctamente"}, status=200)
    except PlayList.DoesNotExist:
        return JsonResponse({"error": "Playlist no encontrada"}, status=404)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@require_http_methods(["PUT"])
def update_playlist(request, playlist_id):
    """Actualiza el nombre de una playlist a partir de un cuerpo JSON."""
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
        return JsonResponse({"error": str(e)}, status=500)


@require_http_methods(["GET"])
def get_all_songs(request):
    """Devuelve un listado básico de canciones públicas (id, título, artista)."""
    try:
        songs = Song.objects.filter(visibility="public").values(
            "id", "title", "artist_display_name"
        )
        return JsonResponse(list(songs), safe=False)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


def _get_session_user_obj(request):
    """Devuelve la instancia Users asociada a request.session['user'], o None si no existe."""
    username = request.session.get("user")
    if not username:
        return None
    try:
        return Users.objects.get(user=username)
    except Users.DoesNotExist:
        return None


@require_http_methods(["GET"])
def mis_likes_json(request):
    """
    Devuelve las canciones marcadas con "like" por el usuario autenticado,
    en el formato esperado por el reproductor.
    """
    user = _get_session_user_obj(request)
    if not user:
        return JsonResponse({"error": "login_required"}, status=401)

    ct_song = ContentType.objects.get_for_model(Song)
    like_qs = LikeMedia.objects.filter(user=user, content_type=ct_song).values_list("object_id", flat=True)

    songs_qs = (
        Song.objects
        .filter(id__in=list(like_qs), visibility="public")
        .only("id", "title", "artist_display_name", "genre", "audio_file", "cover_image")
        .order_by("-created_at")
    )

    def _audio_url(s):
        return _safe_file_url(getattr(s, "audio_file", None)) or ""

    def _cover_url(s):
        cu = _safe_file_url(getattr(s, "cover_image", None))
        return cu or None

    songs = []
    for s in songs_qs:
        au = _audio_url(s)
        if not au:
            continue
        songs.append({
            "id": s.id,
            "title": s.title,
            "artist_display_name": getattr(s, "artist_display_name", "") or "",
            "genre": getattr(s, "genre", "") or "",
            "audioUrl": au,
            "coverUrl": _cover_url(s),
        })

    return JsonResponse({"id": "pl:likes", "name": "Mis likes", "songs": songs})


@csrf_exempt
@require_http_methods(["POST"])
def add_song_to_playlist(request):
    """Agrega una canción a una playlist a partir de un cuerpo JSON."""
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
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@require_http_methods(["DELETE"])
def remove_song_from_playlist(request):
    """Elimina una canción de una playlist a partir de un cuerpo JSON."""
    try:
        data = json.loads(request.body)
        playlist_id = data.get("playlist_id")
        song_id = data.get("song_id")

        if playlist_id is None or song_id is None:
            return JsonResponse({"error": "Se requieren playlist_id y song_id"}, status=400)

        deleted_count, _ = PlayListSong.objects.filter(
            playlist_id=playlist_id,
            song_id=song_id
        ).delete()

        if deleted_count == 0:
            return JsonResponse({"error": "Registro no encontrado"}, status=404)

        return JsonResponse({"message": "Canción eliminada de la playlist"}, status=200)

    except json.JSONDecodeError:
        return JsonResponse({"error": "JSON inválido"}, status=400)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# ---------- Búsqueda ----------

def buscar(request):
    """
    Búsqueda de canciones públicas, artistas y playlists públicas (vista HTML).

    Requiere que el usuario haya iniciado sesión.
    """
    if "user" not in request.session:
        messages.error(request, "Debes iniciar sesión para acceder a esta página.")
        return redirect("login")

    query = request.GET.get("q", "").strip()
    resultados = {"canciones": [], "artistas": [], "playlists": []}

    if query:
        resultados["canciones"] = (
            Song.objects
            .filter(Q(title__icontains=query) | Q(artist_display_name__icontains=query), visibility="public")
            .only("id", "title", "artist_display_name", "audio_file", "cover_image", "genre")
        )[:20]

        resultados["artistas"] = (
            Users.objects
            .filter(Q(user__icontains=query) & Q(type__iexact="artista"))
            .only("id", "user", "avatar", "created_at")
        )[:20]

        resultados["playlists"] = (
            PlayList.objects
            .filter(Q(name__icontains=query) & Q(isprivate=False))
            .only("id", "idUser", "name", "portada", "isprivate", "created_at")
        )[:20]

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

    Devuelve hasta 5 coincidencias por tipo: canciones, artistas y playlists públicas.
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
            results["canciones"].append({
                "id": c.id,
                "title": c.title,
                "artist": c.artist_display_name,
                "audioUrl": _safe_file_url(c.audio_file),
                "coverUrl": _safe_file_url(c.cover_image),
            })

        # Artistas
        artistas = Users.objects.filter(Q(user__icontains=query) & Q(type__iexact="artista"))[:5]
        for a in artistas:
            results["artistas"].append({
                "id": a.id,
                "username": a.user,
                "avatarUrl": _safe_file_url(a.avatar),
            })

        # Playlists públicas
        playlists = PlayList.objects.filter(Q(name__icontains=query) & Q(isprivate=False))[:5]
        for p in playlists:
            results["playlists"].append({
                "id": p.id,
                "name": p.name,
                "coverUrl": p.portada,
            })

    except Exception as e:
        logger.error(f"Error en api_buscar: {str(e)}")

    return JsonResponse(results)


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

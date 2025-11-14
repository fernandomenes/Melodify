import json
import logging

from django.contrib import messages
from django.db.models import Q 
from django.contrib.auth import logout as django_logout
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt, csrf_protect
from django.views.decorators.http import require_http_methods
from django.contrib.contenttypes.models import ContentType
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_POST

from .models import ArtistProfile, PlayList, PlayListSong, Song, Users, LikeMedia

logger = logging.getLogger(__name__)


def pantallaPrincipal(request):
    """
    Renderiza la pantalla principal pública.
    """
    return render(request, "inicio_sesion/principal.html")


def _safe_file_url(f):
    """
    Devuelve una URL segura para un FileField/ImageField.

    Si el archivo no tiene nombre o no es accesible, retorna cadena vacía
    para evitar excepciones en plantillas o serialización.
    """
    try:
        return f.url if getattr(f, "name", "") else ""
    except Exception:
        return ""


def pantallaHome(request):
    """
    Renderiza la pantalla autenticada.

    - Verifica existencia de sesión.
    - Obtiene metadatos del usuario (avatar, fecha de creación, descripción).
    - Si el rol es "Artista", construye la playlist virtual “Mi música” con
      canciones públicas del propietario.
    - Inyecta un JSON de playlists en el contexto.
    """
    if "user" not in request.session:
        messages.error(request, "Debes iniciar sesión para acceder a esta página.")
        return redirect('login')

    session_user = request.session.get("user", "")
    session_role = request.session.get("role", "")
    role_lower = (session_role or "").lower()

    avatar_url = ""
    artist_description = ""
    created_at_str = ""

    try:
        u = Users.objects.get(user=session_user)
        if getattr(u, "avatar", None):
            try:
                avatar_url = u.avatar.url
            except Exception:
                avatar_url = str(u.avatar)
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
                "audioUrl": _safe_file_url(s.audio_file) or str(s.audio_file),
                "coverUrl": _safe_file_url(s.cover_image) or (str(s.cover_image) if s.cover_image else None),
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
    """
    Gestiona el formulario de registro de usuarios.

    En POST valida los campos y crea un registro en Users.
    """
    if request.method == 'POST':
        username = request.POST.get('username')
        password = request.POST.get('password')
        confirm_password = request.POST.get('confirm_password')

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
                nuevo_usuario = Users(
                    user=username.strip(),
                    password=password,
                    type='Usuario',
                    is_superadmin=False,
                    is_active=True
                )
                nuevo_usuario.save()
                messages.success(request, "¡Registro exitoso! Ahora puedes iniciar sesión.")
                return redirect('login')
            except Exception as e:
                errors.append(f"Error al crear el usuario: {str(e)}")

        for error in errors:
            messages.error(request, error)

    return render(request, 'inicio_sesion/registro.html')


def pantallaLogin(request):
    """
    Gestiona el inicio de sesión.

    - En POST valida credenciales frente a Users.
    - Reestablece la clave de sesión.
    - Limpia llaves temporales de “deshacer”.
    - Persiste usuario y rol en la sesión.
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


@require_http_methods(["GET", "POST"])
@csrf_protect
def pantallaLogout(request):
    """
    Cierra la sesión del usuario, limpia la sesión y establece encabezados
    para evitar almacenamiento en caché del navegador.
    """
    request.session.flush()
    django_logout(request)

    messages.success(request, "Sesión cerrada correctamente.")

    response = redirect('login')
    response['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response['Pragma'] = 'no-cache'
    response['Expires'] = '0'

    if hasattr(request, 'session'):
        request.session.flush()

    return response


def playlist_getAll(request):
    """
    Devuelve un listado plano de playlists en formato JSON.
    """
    data = list(
        PlayList.objects.values(
            'id', 'idUser', 'name', 'portada', 'isprivate', 'created_at'
        )
    )
    return JsonResponse(data, safe=False)



@csrf_exempt
@require_http_methods(["POST"])
def create_playlist(request):
    try:
        data = json.loads(request.body)
        username = data.get('user')
        playlist_name = data.get('name')

        if not username or not playlist_name:
            return JsonResponse({'error': 'Faltan campos: user y name'}, status=400)

        # Buscar usuario en la tabla Users
        try:
            user_obj = Users.objects.get(user=username)
        except Users.DoesNotExist:
            return JsonResponse({'error': 'Usuario no encontrado'}, status=404)

        # Crear playlist
        new_playlist = PlayList(
            idUser=user_obj.id,          # ← usamos el id del modelo Users
            name=playlist_name,
            portada="",
            isprivate=False
        )
        new_playlist.save()

        return JsonResponse({
            'message': 'Playlist creada exitosamente',
            'playlist_id': new_playlist.id
        }, status=201)

    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)




@require_http_methods(["GET"])
def get_songs_by_playlist(request, playlist_id):
    """
    Retorna las canciones de una playlist con el formato requerido por el
    reproductor, preservando el orden definido en la tabla intermedia.

    Formato por canción:
    - id
    - title
    - artist_display_name
    - genre
    - audioUrl
    - coverUrl
    - likes_count
    - liked
    """
    try:
        logger.info(f"Buscando canciones para playlist_id: {playlist_id}")

        # Obtiene el orden original desde la tabla intermedia.
        playlist_songs = PlayListSong.objects.filter(
            playlist_id=playlist_id
        ).order_by('position')

        if not playlist_songs.exists():
            logger.warning(f"No se encontraron canciones para playlist_id={playlist_id}")
            return JsonResponse({'songs': []})

        song_ids = [ps.song_id for ps in playlist_songs]
        logger.info(f"song_ids encontrados: {song_ids}")

        # Trae Song con los campos utilizados en la vista de inicio.
        qs = Song.objects.filter(id__in=song_ids).only(
            "id", "title", "artist_display_name", "genre", "audio_file", "cover_image"
        )

        # Normaliza a la estructura consumida por el frontend.
        def _audio_url(s):
            return _safe_file_url(getattr(s, "audio_file", None)) or str(getattr(s, "audio_file", "")) or ""

        def _cover_url(s):
            cu = _safe_file_url(getattr(s, "cover_image", None))
            if not cu:
                ci = getattr(s, "cover_image", None)
                cu = str(ci) if ci else ""
            return cu or None

        # --- Calcular likes totals y qué canciones gusta al usuario ---
        # ContentType del modelo Song
        ct_song = ContentType.objects.get_for_model(Song)

        # Todas las likes para estas canciones
        likes_qs = LikeMedia.objects.filter(content_type=ct_song, object_id__in=song_ids)

        # Conteos por canción
        counts = {}
        for l in likes_qs:
            counts[l.object_id] = counts.get(l.object_id, 0) + 1

        # Usuario en sesión (si hay)
        def _get_session_user_obj_local(req):
            username = req.session.get("user")
            if not username:
                return None
            try:
                return Users.objects.get(user=username)
            except Users.DoesNotExist:
                return None

        user = _get_session_user_obj_local(request)
        user_liked_set = set()
        if user:
            user_liked_set = set(likes_qs.filter(user=user).values_list('object_id', flat=True))

        # --- Construir mapa de canciones con campos extras ---
        songs_map = {}
        for s in qs:
            songs_map[s.id] = {
                "id": s.id,
                "title": s.title,
                "artist_display_name": getattr(s, "artist_display_name", "") or "",
                "genre": getattr(s, "genre", "") or "",
                "audioUrl": _audio_url(s),
                "coverUrl": _cover_url(s),
                # Campos nuevos:
                "likes_count": counts.get(s.id, 0),
                "liked": (s.id in user_liked_set),
            }

        # Reconstruye el orden definido en la playlist y omite entradas sin audio.
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

        return JsonResponse({'songs': ordered})

    except Exception as e:
        logger.error(f"Error en get_songs_by_playlist: {str(e)}", exc_info=True)
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@require_http_methods(["DELETE"])
def delete_playlist(request, playlist_id):
    try:
        playlist = PlayList.objects.get(id=playlist_id)
        playlist.delete()
        return JsonResponse({'message': 'Playlist eliminada correctamente'}, status=200)
    except PlayList.DoesNotExist:
        return JsonResponse({'error': 'Playlist no encontrada'}, status=404)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)




@csrf_exempt
@require_http_methods(["PUT"])
def update_playlist(request, playlist_id):
    try:
        # Obtener la playlist
        playlist = PlayList.objects.get(id=playlist_id)

        # Parsear el cuerpo de la solicitud
        data = json.loads(request.body)
        new_name = data.get('name')

        if not new_name or not new_name.strip():
            return JsonResponse({'error': 'El nombre no puede estar vacío'}, status=400)

        # Actualizar nombre
        playlist.name = new_name.strip()
        playlist.save()

        return JsonResponse({
            'message': 'Playlist actualizada correctamente',
            'name': playlist.name
        }, status=200)

    except PlayList.DoesNotExist:
        return JsonResponse({'error': 'Playlist no encontrada'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)




@require_http_methods(["GET"])
def get_all_songs(request):
    try:
        songs = Song.objects.filter(visibility="public").values(
            "id", "title", "artist_display_name"
        )
        song_list = list(songs)  # Convertir a lista de dicts
        return JsonResponse(song_list, safe=False)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)




@csrf_exempt
@require_http_methods(["POST"])
def add_song_to_playlist(request):
    try:
        data = json.loads(request.body)
        song_id = data.get('song_id')
        playlist_id = data.get('playlist_id')
        position = data.get('position')

        if song_id is None or playlist_id is None or position is None:
            return JsonResponse({'error': 'Faltan parámetros: song_id, playlist_id, position'}, status=400)

        # Crear la relación en PlayListSong
        new_entry = PlayListSong(
            playlist_id=playlist_id,
            song_id=song_id,
            position=position
        )
        new_entry.save()

        return JsonResponse({
            'message': 'Canción agregada a la playlist',
            'position': position
        }, status=201)

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)



@csrf_exempt
@require_http_methods(["DELETE"])
def remove_song_from_playlist(request):
    try:
        # Parsear el cuerpo de la solicitud (JSON)
        data = json.loads(request.body)
        playlist_id = data.get('playlist_id')
        song_id = data.get('song_id')

        if playlist_id is None or song_id is None:
            return JsonResponse(
                {'error': 'Se requieren playlist_id y song_id'},
                status=400
            )

        # Buscar y eliminar el registro
        deleted_count, _ = PlayListSong.objects.filter(
            playlist_id=playlist_id,
            song_id=song_id
        ).delete()

        if deleted_count == 0:
            return JsonResponse(
                {'error': 'Registro no encontrado'},
                status=404
            )

        return JsonResponse(
            {'message': 'Canción eliminada de la playlist'},
            status=200
        )

    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

def buscar(request):
    """
    Vista de búsqueda que consulta canciones, artistas y playlists
    """
    if "user" not in request.session:
        messages.error(request, "Debes iniciar sesión para acceder a esta página.")
        return redirect('login')
    
    query = request.GET.get('q', '').strip()
    resultados = {
        'canciones': [],
        'artistas': [],
        'playlists': [],
    }
    
    if query:
        # Buscar canciones (públicas) por título o artista
        resultados['canciones'] = Song.objects.filter(
            Q(title__icontains=query) | Q(artist_display_name__icontains=query),
            visibility='public'
        ).select_related('owner').only(
            "id", "title", "artist_display_name", "audio_file", "cover_image", "genre"
        )[:20]
        
        # Buscar artistas (usuarios con tipo 'Artista')
        resultados['artistas'] = Users.objects.filter(
            Q(user__icontains=query) & Q(type__iexact='artista')
        ).only(
            "id", "user", "avatar", "created_at"
        )[:20]
        
        # Buscar playlists por nombre (públicas)
        resultados['playlists'] = PlayList.objects.filter(
            Q(name__icontains=query) & Q(isprivate=False)
        ).select_related('idUser').only(
            'id', 'idUser', 'name', 'portada', 'isprivate', 'created_at'
        )[:20]
    
    # Obtener datos de sesión para el template
    session_user = request.session.get("user", "")
    session_role = request.session.get("role", "")
    
    avatar_url = ""
    try:
        u = Users.objects.get(user=session_user)
        if getattr(u, "avatar", None):
            try:
                avatar_url = u.avatar.url
            except Exception:
                avatar_url = str(u.avatar)
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
    """API para búsqueda en tiempo real"""
    query = request.GET.get('q', '').strip()
    
    if len(query) < 2:
        return JsonResponse({'canciones': [], 'artistas': [], 'playlists': []})
    
    results = {
        'canciones': [],
        'artistas': [], 
        'playlists': [],
    }
    
    try:
        # Buscar canciones
        canciones = Song.objects.filter(
            Q(title__icontains=query) | Q(artist_display_name__icontains=query),
            visibility='public'
        )[:5]
        
        for cancion in canciones:
            results['canciones'].append({
                'id': cancion.id,
                'title': cancion.title,
                'artist': cancion.artist_display_name,
                'audioUrl': _safe_file_url(cancion.audio_file),
                'coverUrl': _safe_file_url(cancion.cover_image),
            })
        
        # Buscar artistas
        artistas = Users.objects.filter(
            Q(user__icontains=query) & Q(type__iexact='artista')
        )[:5]
        
        for artista in artistas:
            results['artistas'].append({
                'id': artista.id,
                'username': artista.user,
                'avatarUrl': _safe_file_url(artista.avatar),
            })
        
        # Buscar playlists
        playlists = PlayList.objects.filter(
            Q(name__icontains=query) & Q(isprivate=False)
        )[:5]
        
        for playlist in playlists:
            results['playlists'].append({
                'id': playlist.id,
                'name': playlist.name,
                'coverUrl': playlist.portada,
            })
            
    except Exception as e:
        logger.error(f"Error en api_buscar: {str(e)}")
    
    return JsonResponse(results)

def _get_session_user_obj(request):
    """
    Devuelve la instancia Users asociada a request.session['user'] o None.
    (Esto encaja con la forma en que tu proyecto maneja la sesión en views.py)
    """
    username = request.session.get("user")
    if not username:
        return None
    try:
        return Users.objects.get(user=username)
    except Users.DoesNotExist:
        return None


@require_POST
def like_song(request, song_id):
    """Toggle like para canción. POST -> {liked: bool, total: int}"""
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
    """Toggle like para playlist. POST -> {liked: bool, total: int}"""
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

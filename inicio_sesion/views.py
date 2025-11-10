import json
import logging

from django.contrib import messages
from django.contrib.auth import logout as django_logout
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt, csrf_protect
from django.views.decorators.http import require_http_methods

from .models import ArtistProfile, PlayList, PlayListSong, Song, Users

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
def playlist_insert(request):
    """
    Inserta una nueva playlist a partir de un cuerpo JSON en una solicitud POST.
    """
    if request.method == 'POST':
        data = json.loads(request.body)
        PlayList.objects.create(
            idUser=data['idUser'],
            name=data['name'],
            portada=data['portada'],
            isprivate=data.get('isprivate', False),
            created_at=timezone.now()
        )
        return JsonResponse({'status': 'creada'})
    return JsonResponse({'error': 'usa POST'}, status=400)


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

        songs_map = {}
        for s in qs:
            songs_map[s.id] = {
                "id": s.id,
                "title": s.title,
                "artist_display_name": getattr(s, "artist_display_name", "") or "",
                "genre": getattr(s, "genre", "") or "",
                "audioUrl": _audio_url(s),
                "coverUrl": _cover_url(s),
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

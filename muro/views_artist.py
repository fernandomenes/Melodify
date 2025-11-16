# muro/views_artist.py
# ============================================================================
# Melodify — Vistas del muro de artista
#
# Vistas de servidor para:
#   - Muro público y privado del artista.
#   - CRUD de canciones (subida, edición, eliminado, undo).
#   - Subida masiva de múltiples audios.
#   - Endpoints JSON de integración con el reproductor central.
#   - Fragmentos HTML para futuras secciones (playlists del artista).
# ============================================================================

"""
Vistas del muro de artista: sección pública/propia, gestión de canciones (CRUD),
subida masiva y fragmentos de UI relacionados.

Este módulo concentra toda la lógica específica del "muro" de artista:

- Vistas públicas y privadas del muro (muro_publico / mi_muro).
- Subida, edición, eliminación y undo de canciones individuales.
- Subida masiva de canciones a partir de múltiples archivos.
- Endpoints JSON para integrar el muro con el reproductor central.
- Pequeños fragmentos de HTML para futuras secciones (playlists del artista).

La intención es que la lógica de negocio quede contenida aquí y el resto de
la app (inicio_sesion, reproductor, etc.) consuma estos endpoints de forma
predecible.
"""

import json
import os
import re
from hashlib import sha256
from pathlib import Path
from typing import Optional
from uuid import uuid4

from django.contrib import messages
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import transaction
from django.http import (
    HttpResponse,
    HttpResponseBadRequest,
    JsonResponse,
)
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_http_methods

from inicio_sesion import base as base
from inicio_sesion.auth_helpers import _get_user_role, _is_artist, _require_session_user
from inicio_sesion.models import ArtistProfile, Song, Users, LikeMedia

# =============================================================================
# Configuración / constantes
# =============================================================================

# Máximo de archivos permitidos en la subida masiva
_MAX_FILES = 30

# Tamaño máximo de cada archivo de audio (20 MB)
_MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB

# Extensiones de audio permitidas en la subida masiva
_ALLOWED_EXTS = {"mp3", "wav", "ogg", "m4a", "flac"}

# Si es True, se aplica un filtro más estricto a los títulos
STRICT_TITLE_FILTER = True

# =============================================================================
# Helpers generales
# =============================================================================


def _is_fetch(request) -> bool:
    """
    Indica si la petición fue enviada por fetch/AJAX.

    Se basa en el encabezado `X-Requested-With` que el front envía
    como 'fetch' cuando no se trata de un POST/GET clásico de navegador.
    """
    return (request.headers.get("X-Requested-With") or "").lower() == "fetch"


def _redirect_login_clean(request):
    """
    Limpia mensajes pendientes en el sistema de `messages` y redirige al login.

    Esta función se usa cuando no hay usuario de sesión pero queremos
    evitar que se queden mensajes "colgados" antes de mandar al login.
    """
    for _ in messages.get_messages(request):
        # Consumimos todos los mensajes sin mostrarlos.
        pass
    return redirect("login")


def _storage():
    """
    Devuelve el storage a utilizar para archivos de audio/portadas.

    Si en `inicio_sesion.base` se define `_AUDIO_STORAGE`, se usa ese.
    De lo contrario, se recurre al storage por defecto de Django.
    """
    return getattr(base, "_AUDIO_STORAGE", default_storage)


def _safe_file_url(field) -> str:
    """
    Devuelve una URL "segura" para un FileField/ImageField.

    - Si el campo no tiene valor, devuelve cadena vacía.
    - Intenta usar `field.url` normalmente.
    - Si falla, intenta reconstruir la URL mediante el storage configurado.
    - Como último recurso, devuelve `str(field)`.

    Esto evita que fallos de storage/URL rompan las vistas o el JSON.
    """
    if not field:
        return ""
    try:
        return field.url
    except Exception:
        try:
            name = getattr(field, "name", "") or ""
            if name and hasattr(_storage(), "url"):
                return _storage().url(name)
        except Exception:
            pass
    return str(field) if field else ""


def _delete_storage_entry(file_or_url) -> None:
    """
    Elimina una entrada del storage a partir del FileField o de su nombre/URL.

    - Normaliza el nombre en caso de que venga ya con el `base_url` incluido.
    - Ignora silenciosamente cualquier error (no queremos romper flujo
      de usuario por fallos puntuales de almacenamiento).
    """
    try:
        storage = _storage()
        name = getattr(file_or_url, "name", "") or str(file_or_url) or ""
        base_url = getattr(storage, "base_url", "") or ""
        if base_url:
            prefix = base_url.rstrip("/") + "/"
            if name.startswith(prefix):
                name = name[len(prefix):].lstrip("/")
        if name:
            storage.delete(name)
    except Exception:
        # Los errores de borrado no deben bloquear el flujo del usuario.
        pass


def _delete_song_files(song: Song) -> None:
    """
    Elimina del storage los archivos asociados a una canción.

    - Borra el archivo de audio (audio_file).
    - Borra la portada (cover_image) si existe.

    No elimina la instancia de Song en la base de datos, solo sus archivos.
    """
    storage = _storage()
    try:
        name = getattr(song.audio_file, "name", "") or ""
        if name:
            storage.delete(name)
    except Exception:
        pass
    try:
        if getattr(song, "cover_image", None):
            cname = getattr(song.cover_image, "name", "") or ""
            if cname:
                storage.delete(cname)
    except Exception:
        pass


def _get_artist_profile_by_username(username: str) -> Optional[ArtistProfile]:
    """
    Devuelve el ArtistProfile asociado a un username, o None si no existe.

    Esta función encapsula la lógica de obtención del perfil de artista
    y maneja las excepciones de DoesNotExist de forma silenciosa.
    """
    try:
        user = Users.objects.get(user=username)
        return user.artist_profile
    except (Users.DoesNotExist, ArtistProfile.DoesNotExist):
        return None


# =============================================================================
# Heurísticas de título / hash
# =============================================================================

# Expresiones regulares para detectar nombres tipo hash/UUID/base64
_GUID_RE = re.compile(r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$", re.I)
_HEX_LONG_RE = re.compile(r"[0-9a-f]{16,}", re.I)
_B64ISH_RE = re.compile(r"^[A-Za-z0-9+/]{24,}={0,2}$")

# Conjunto de caracteres que consideramos "palabras" (incluye acentos y ñ)
_WORD_CHARS = "a-záéíóúñü"
_VOWELS = "aeiouáéíóú"


def _normalize_base(filename: str) -> str:
    """
    Normaliza el nombre base de un archivo para usarlo como título candidato.

    - Quita la extensión.
    - Sustituye guiones, guiones bajos y puntos por espacios.
    - Colapsa espacios múltiples en uno solo.
    """
    base = os.path.splitext(filename)[0]
    base = re.sub(r"[_\-\.]+", " ", base)
    base = re.sub(r"\s+", " ", base).strip()
    return base


def _clean_title(filename: str) -> str:
    """
    Limpia un nombre de archivo para convertirlo en título:

    - Elimina prefijos numéricos tipo "01 - ", "1) " al inicio.
    - Reemplaza guiones/barras bajas por espacios.
    - Devuelve 'Nueva canción' si el resultado queda vacío.
    """
    name = os.path.splitext(filename)[0]
    name = re.sub(r"^\s*\d+[)\-._\s]+", "", name)
    name = name.replace("_", " ").replace("-", " ").strip()
    return name or "Nueva canción"


def _title_candidate_from_filename(filename: str) -> str:
    """
    Obtiene un título candidato a partir del nombre de archivo:

    Combina la limpieza básica (`_clean_title`) con la normalización
    de espacios (`_normalize_base`).
    """
    return _normalize_base(_clean_title(filename))


def _looks_random(name: str) -> bool:
    """
    Heurística para detectar si un nombre parece aleatorio:

    - Coincide con el patrón de un UUID.
    - Contiene un tramo largo de hexadecimales.
    - Coincide con una cadena tipo base64 larga.
    """
    if _GUID_RE.fullmatch(name):
        return True
    if _HEX_LONG_RE.search(name):
        return True
    if _B64ISH_RE.fullmatch(name):
        return True
    return False


def _title_is_sensible(title: str) -> tuple[bool, str]:
    """
    Valida si un título es "sensato" para exposición al usuario.

    Devuelve:
        (True, "") si el título pasa las heurísticas.
        (False, motivo) en caso contrario.

    Criterios (cuando STRICT_TITLE_FILTER es True):
    - Longitud mínima (>= 3).
    - No parece un hash/UUID/base64 (_looks_random).
    - No es una cadena sin vocales larga (tipo 'FJNRK').
    - Proporción aceptable de letras vs dígitos/símbolos.
    - Contiene alguna palabra reconocible (3+ letras).
    - No es excesivamente largo (> 120 caracteres).
    """
    if not STRICT_TITLE_FILTER:
        return True, ""

    if len(title) < 3:
        return False, "muy corto"

    compact = re.sub(r"\s+", "", title)
    letters = re.findall(rf"[{_WORD_CHARS}]", title, flags=re.I)
    digits = re.findall(r"\d", title)
    vowels = re.findall(rf"[{_VOWELS}]", title, flags=re.I)

    letter_ratio = len(letters) / max(1, len(compact))
    digit_ratio = len(digits) / max(1, len(compact))

    if _looks_random(title):
        return False, "parece un identificador (hash/UUID/base64)"

    if len(letters) >= 5 and len(vowels) == 0:
        return False, "sin vocales (parece código aleatorio)"

    if letter_ratio < 0.5 and digit_ratio > 0.3:
        return False, "demasiados números/símbolos"

    tokens = title.split()
    long_words = [t for t in tokens if re.fullmatch(rf"[{_WORD_CHARS}]{{3,}}", t, flags=re.I)]
    if not long_words:
        return False, "no contiene palabras reconocibles"

    if len(title) > 120:
        return False, "demasiado largo"

    return True, ""


def _sha256_file(django_file) -> str:
    """
    Calcula el hash SHA-256 de un archivo subido (UploadedFile / InMemoryUploadedFile).

    - Lee el archivo en chunks mediante `django_file.chunks()`.
    - Intenta devolver el puntero al inicio con `seek(0)`, si es posible.
    - Devuelve el digest en formato hexadecimal (str de 64 chars).

    Este hash se usa para detectar duplicados de audio del mismo artista.
    """
    h = sha256()
    for chunk in django_file.chunks():
        h.update(chunk)
    try:
        django_file.seek(0)
    except Exception:
        pass
    return h.hexdigest()


# =============================================================================
# Vistas del muro (público/propio)
# =============================================================================


@require_http_methods(["GET"])
def muro_publico(request, username: str):
    """
    Muro público de un artista.

    Flujo:
    - Si `username` corresponde a un Users(type='artista'), se renderiza el
      muro como antes (canciones públicas del artista + descripción).
    - Si no existe o no es artista, se muestra una página amigable de
      "artista no encontrado" con status HTTP 404.

    Además:
    - Se construye, para el usuario en sesión (si existe), una playlist JSON
      "Mi música" para integrar con el reproductor central.
    - Se inyectan datos de la sesión (avatar, descripción propia, fecha de alta)
      para personalizar la barra superior.
    """
    # Intentamos encontrar al artista
    artist_user = Users.objects.filter(user=username, type__iexact="artista").first()

    # =====================================================================
    # CASO: artista NO registrado -> página de "no encontrado"
    # =====================================================================
    if not artist_user:
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
                    session_avatar_url = _safe_file_url(u.avatar)
                if getattr(u, "created_at", None):
                    session_created_at = u.created_at.strftime("%Y-%m-%d %H:%M")
                if role_lower == "artista":
                    try:
                        session_artist_desc = (u.artist_profile.description or "").strip()
                    except ArtistProfile.DoesNotExist:
                        session_artist_desc = ""
            except Users.DoesNotExist:
                pass

        ctx = {
            "requested_username": username,
            "session_user": session_user,
            "session_role": session_role,
            "session_avatar_url": session_avatar_url,
            "session_description": session_artist_desc,
            "session_created_at": session_created_at,
        }
        # status=404 para que siga siendo “no encontrado” pero con página amigable
        return render(request, "muro/artista_no_encontrado.html", ctx, status=404)

    # =====================================================================
    # CASO NORMAL: artista registrado -> muro como antes
    # =====================================================================
    try:
        prof = artist_user.artist_profile
        wall_description = (prof.description or "").strip()
    except ArtistProfile.DoesNotExist:
        wall_description = ""

    # ================== Canciones públicas del artista ==================
    songs_qs = Song.objects.filter(
        owner_user=username, visibility="public"
    ).only(
        "id",
        "title",
        "artist_display_name",
        "created_at",
        "cover_image",
        "audio_file",
        "genre",
    )

    # Lo convertimos a lista para poder iterar y añadir flags
    songs = list(songs_qs)

    # ================== Marcar likes del usuario actual ==================
    session_user = request.session.get("user", "")
    session_role = request.session.get("role", "")
    role_lower = (session_role or "").lower()

    # Estos se usan en más partes, así que los dejamos como estaban
    session_avatar_url = ""
    session_artist_desc = ""
    session_created_at = ""

    if session_user:
        try:
            u = Users.objects.get(user=session_user)
            if getattr(u, "avatar", None):
                session_avatar_url = _safe_file_url(u.avatar)
            if getattr(u, "created_at", None):
                session_created_at = u.created_at.strftime("%Y-%m-%d %H:%M")
            if role_lower == "artista":
                try:
                    session_artist_desc = (u.artist_profile.description or "").strip()
                except ArtistProfile.DoesNotExist:
                    session_artist_desc = ""
        except Users.DoesNotExist:
            pass

    # ⚠️ Ajusta este filtro si tu LikeMedia usa otros campos.
    liked_ids = set()
    if session_user and songs:
        try:
            liked_ids = set(
                LikeMedia.objects.filter(
                    user__user=session_user,   # FK a Users.user
                    song__in=songs,
                    is_like=True,
                ).values_list("song_id", flat=True)
            )
        except Exception:
            liked_ids = set()

    # Inyectar flag en cada Song para la plantilla
    for s in songs:
        s.is_liked = s.id in liked_ids

    # Playlist "Mi música" para el propietario (integración con reproductor)
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
                "audioUrl": _safe_file_url(s.audio_file),
                "coverUrl": _safe_file_url(s.cover_image) or None,
                "genre": getattr(s, "genre", "") or "",
            }
            for s in qs
        ]
        playlists.append({"id": 1, "name": "Mi música", "songs": songs_json})

    # Datos de undo (el borrado/creación más reciente en el muro)
    undo_muro_data = request.session.get("mi_muro_undo")
    if undo_muro_data and undo_muro_data.get("owner") != session_user:
        # Si el owner almacenado no es el usuario actual, descartamos el undo
        undo_muro_data = None
    undo_muro_label = request.session.get("mi_muro_undo_label") if undo_muro_data else None

    ctx = {
        "artist": artist_user,
        "description": wall_description,
        "songs": songs,  # <- la lista con s.is_liked rellenado
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

    return render(request, "muro/muro_artista.html", ctx)


@require_http_methods(["GET"])
def mi_muro(request):
    """
    Atajo para que el artista autenticado vea su propio muro.

    - Requiere usuario de sesión.
    - Requiere que el rol sea de artista.
    - Internamente delega en `muro_publico` con su propio username,
      para reutilizar la misma plantilla y la misma lógica de contexto.
    """
    username = _require_session_user(request)
    if not username:
        return _redirect_login_clean(request)
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)
    return muro_publico(request, username)


# =============================================================================
# Canciones (subir/editar/eliminar/undo + JSON)
# =============================================================================


@require_http_methods(["POST"])
def subir_cancion_en_muro(request):
    """
    Subida de canción desde el muro del artista.

    El campo artist_display_name ya no proviene del formulario: se fija siempre
    al nombre de usuario autenticado (username), para garantizar consistencia
    con el artista propietario.

    Lógica principal:
    - Valida login + rol de artista.
    - Limpia/valida el título (o lo infiere del nombre de archivo).
    - Verifica duplicados por título y por hash de audio (SHA-256).
    - Guarda audio y portada en el storage configurado.
    - Crea la instancia Song y registra una operación de undo en sesión.

    Respuesta:
    - Si la petición es vía fetch (X-Requested-With=fetch), devuelve JSON.
    - De lo contrario, redirige al muro con mensajes de Django.
    """
    username = _require_session_user(request)
    if not username:
        return _redirect_login_clean(request)
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)
    is_fetch = _is_fetch(request)

    def _json_err(msg, status=400):
        """Helper interno para respuestas de error JSON homogéneas."""
        return JsonResponse({"ok": False, "error": msg}, status=status)

    title = (request.POST.get("title") or "").strip()
    genre = (request.POST.get("genre") or "").strip()
    audio = request.FILES.get("audio_file")
    cover = request.FILES.get("cover_image")

    # El autor principal SIEMPRE será el usuario logueado
    artist_display_name = username

    # ======================= Validación de título =======================
    if not title:
        # Permitimos inferirlo a partir del nombre del archivo de audio
        if audio:
            candidate = _title_candidate_from_filename(audio.name)
            ok_title, why = _title_is_sensible(candidate)
            if ok_title:
                title = candidate
            else:
                msg = f"Título inválido ({why})."
                return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")
        else:
            msg = "Título requerido"
            return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")
    else:
        ok_title, why = _title_is_sensible(title)
        if not ok_title:
            msg = f"Título no válido ({why})."
            return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")

    # ======================= Audio obligatorio ==========================
    if audio is None:
        msg = "El archivo de audio es obligatorio."
        return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")

    # ======================= Duplicados / límites =======================
    if Song.objects.filter(owner_user=username, visibility="public", title__iexact=title).exists():
        msg = "Ya tienes una canción con ese título."
        return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")

    if getattr(audio, "size", 0) > _MAX_FILE_SIZE:
        msg = f"El archivo excede {int(_MAX_FILE_SIZE/1024/1024)} MB."
        return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")

    # Detecta duplicados por contenido (hash SHA-256 del audio)
    audio_digest = _sha256_file(audio)
    if audio_digest and Song.objects.filter(
        owner_user=username, visibility="public", audio_sha256=audio_digest
    ).exists():
        msg = "Ya subiste este mismo audio antes."
        return _json_err(msg) if is_fetch else _redirect_error(request, msg, "mi_muro")

    storage = _storage()
    try:
        audio_ext = Path(audio.name).suffix or ""
        audio_name = f"uploaded_songs/audio_{username}_{uuid4().hex}{audio_ext}"

        cover_name = None
        if cover:
            cover_ext = Path(cover.name).suffix or ""
            cover_name = f"uploaded_covers/cover_{username}_{uuid4().hex}{cover_ext}"

        with transaction.atomic():
            # Guardamos archivos en storage
            saved_audio = storage.save(audio_name, audio)
            saved_cover = storage.save(cover_name, cover) if cover_name else None

            # Creamos la Song asociada al artista/owner actual
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

        # Registramos undo: si el usuario se arrepiente, puede eliminar la canción
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
                        "audio_url": _safe_file_url(song.audio_file),
                        "cover_url": _safe_file_url(song.cover_image),
                        "genre": getattr(song, "genre", "") or "",
                        "editar_url": f"/mi-muro/cancion/{song.id}/editar/",
                        "eliminar_url": f"/mi-muro/eliminar/{song.id}/",
                    },
                    "undo": {"label": undo_label, "url": "revertir_mi_cancion"},
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
    """
    Helper para redirigir mostrando un mensaje de error (no fetch).

    - Si la petición no es `fetch`, añade el mensaje al sistema de mensajes.
    - Redirige a la vista identificada por `to_name`.
    """
    if not _is_fetch(request):
        messages.error(request, msg)
    return redirect(to_name)


def _put_undo_muro(request, label: str, data: dict) -> None:
    """
    Almacena en sesión la última operación de undo disponible para el muro.

    Se guardan dos claves:
    - 'mi_muro_undo': dict con la información necesaria para revertir.
    - 'mi_muro_undo_label': texto descriptivo que se muestra al usuario.
    """
    request.session["mi_muro_undo"] = data
    request.session["mi_muro_undo_label"] = label
    request.session.modified = True


def _clear_undo_muro(request) -> None:
    """
    Elimina de la sesión cualquier estado de undo del muro de artista.
    """
    request.session.pop("mi_muro_undo", None)
    request.session.pop("mi_muro_undo_label", None)
    request.session.modified = True


@require_http_methods(["GET", "POST"])
def editar_mi_cancion_en_muro(request, song_id: int):
    """
    Edición de una canción desde el muro del artista.

    El artist_display_name ya no se edita aquí: queda fijado al valor existente
    (normalmente el username del dueño). Solo se permite cambiar título, género
    y portada.

    Flujo:
    - Valida login + rol de artista.
    - Comprueba que la canción pertenece al usuario.
    - En POST, valida título y conflictos de nombres duplicados.
    - Gestiona sustitución/eliminación de portada en el storage.
    - Guarda cambios y retorna al muro del artista.
    """
    username = _require_session_user(request)
    if not username:
        return _redirect_login_clean(request)
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)

    song = get_object_or_404(Song, id=song_id)
    if song.owner_user != username:
        return HttpResponse("No autorizado", status=403)

    if request.method == "POST":
        new_title = (request.POST.get("title") or "").strip()
        new_genre = (request.POST.get("genre") or "").strip()
        remove_cov = (request.POST.get("remove_cover") or "") == "1"
        new_cover = request.FILES.get("cover_image")

        if not new_title:
            if not _is_fetch(request):
                messages.error(request, "El título es obligatorio.")
            return redirect("editar_mi_cancion_en_muro", song_id=song.id)

        try:
            storage = _storage()
            with transaction.atomic():
                # Evita duplicados de título dentro del mismo owner
                if (
                    Song.objects.filter(
                        owner_user=username,
                        visibility="public",
                        title__iexact=new_title,
                    )
                    .exclude(pk=song.id)
                    .exists()
                ):
                    if not _is_fetch(request):
                        messages.error(request, "Ya tienes otra canción con ese título.")
                    return redirect("editar_mi_cancion_en_muro", song_id=song.id)

                # Actualizamos título y género; el autor se mantiene igual
                song.title = new_title
                song.genre = new_genre

                # Manejo de portada: borrar, reemplazar o conservar
                if remove_cov:
                    _delete_storage_entry(song.cover_image)
                    song.cover_image = None
                elif new_cover:
                    _delete_storage_entry(song.cover_image)
                    saved = storage.save(
                        f"uploaded_covers/cover_{username}_{uuid4().hex}{Path(new_cover.name).suffix or ''}",
                        new_cover,
                    )
                    song.cover_image = saved

                # Ya no incluimos artist_display_name en update_fields
                song.save(update_fields=["title", "cover_image", "genre"])

            if not _is_fetch(request):
                messages.success(request, "Cambios guardados.")
            return redirect("mi_muro")
        except Exception:
            if not _is_fetch(request):
                messages.error(request, "No se pudieron guardar los cambios.")
            return redirect("editar_mi_cancion_en_muro", song_id=song.id)

    # GET: renderizamos el formulario de edición
    return render(request, "muro/editar_mi_cancion.html", {"song": song})


@require_http_methods(["POST"])
def eliminar_cancion(request, song_id: int):
    """
    Marca una canción del muro como eliminada (soft delete).

    - Requiere artista autenticado.
    - Solo permite eliminar canciones cuyo owner_user coincide con el usuario.
    - Si la canción es pública, cambia `visibility` a 'removed'.
    - Registra un undo de tipo 'restore_song' para poder recuperarla.
    """
    username = _require_session_user(request)
    if not username:
        return _redirect_login_clean(request)
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

    if _is_fetch(request):
        return JsonResponse({"ok": True, "undo_label": f"Se eliminó “{song.title}”."})
    return redirect("mi_muro")


@require_http_methods(["POST"])
def revertir_mi_cancion(request):
    """
    Ejecuta la última operación de undo almacenada en sesión para el muro.

    Tipos de undo soportados:
    - 'restore_song': restaura la visibilidad de una canción eliminada
      (soft delete -> public).
    - 'delete_song': elimina definitivamente la canción y sus archivos.

    Seguridad:
    - Verifica que el owner en la sesión coincida con el usuario actual.
    - Si la canción ya no existe o no pertenece al usuario, devuelve 403.
    """
    username = _require_session_user(request)
    if not username:
        return _redirect_login_clean(request)
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

    if _is_fetch(request):
        return HttpResponse(status=204)
    return redirect("mi_muro")


@require_http_methods(["GET", "POST"])
def subir_cancion(request):
    """
    Wrapper para compatibilidad con la URL histórica de subida de canción.

    - En POST delega en `subir_cancion_en_muro`.
    - En GET simplemente redirige al muro del artista (no hay formulario
      independiente de subida, todo se hace desde el muro).
    """
    if request.method == "POST":
        return subir_cancion_en_muro(request)

    username = _require_session_user(request)
    if not username:
        return _redirect_login_clean(request)
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)
    return redirect("mi_muro")


@require_http_methods(["GET"])
def mi_musica_json(request):
    """
    Devuelve en JSON las canciones públicas del artista autenticado.

    Estructura de respuesta:
    {
      "ok": true,
      "songs": [
        {
          "id": ...,
          "title": ...,
          "artist_display_name": ...,
          "audio_url": ...,
          "cover_url": ...,
          "genre": ...
        },
        ...
      ]
    }

    Se utiliza para integrar la playlist "Mi música" con el reproductor.
    """
    if "user" not in request.session:
        return JsonResponse({"ok": False, "error": "auth"}, status=401)

    username = request.session.get("user", "")
    qs = Song.objects.filter(owner_user=username, visibility="public").only(
        "id", "title", "artist_display_name", "audio_file", "cover_image", "visibility", "genre"
    )
    songs = [
        {
            "id": s.id,
            "title": s.title,
            "artist_display_name": s.artist_display_name,
            "audio_url": _safe_file_url(s.audio_file),
            "cover_url": _safe_file_url(s.cover_image),
            "genre": getattr(s, "genre", "") or "",
        }
        for s in qs
    ]
    return JsonResponse({"ok": True, "songs": songs})


# =============================================================================
# Subida masiva
# =============================================================================


@require_http_methods(["GET", "POST"])
def subida_masiva(request):
    """
    Vista para subir múltiples canciones de forma masiva desde el muro.

    GET:
        Renderiza el formulario de subida masiva.

    POST:
        - Valida login + rol de artista.
        - Valida número de archivos y tamaño máximo.
        - Exige un género (o 'otro' especificado manualmente).
        - Reutiliza una misma portada opcional (cover_file) para todos los
          audios subidos.
        - Para cada archivo:
            * Verifica extensión permitida.
            * Aplica heurística de título a partir del nombre de archivo.
            * Calcula hash SHA-256 para evitar duplicados exactos.
            * Evita títulos duplicados del mismo artista.
            * Crea la Song y devuelve resultado por archivo.

    Respuesta:
        - Si es fetch: JSON con detalle por archivo.
        - Si es navegación normal: mensaje agregando resumen y redirección.
    """
    username = _require_session_user(request)
    if not username:
        return _redirect_login_clean(request)
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)

    if request.method == "GET":
        return render(
            request,
            "muro/subida_masiva.html",
            {"MAX_FILES": _MAX_FILES, "MAX_MB": int(_MAX_FILE_SIZE / 1024 / 1024)},
        )

    files = request.FILES.getlist("audio_files")
    default_genre = (request.POST.get("genre") or "").strip()
    genre_other = (request.POST.get("genre_other") or "").strip()
    cover_file = request.FILES.get("cover_image")

    if not files:
        return HttpResponseBadRequest("No se enviaron archivos.")
    if len(files) > _MAX_FILES:
        return HttpResponseBadRequest(f"Máximo permitido: {_MAX_FILES} archivos.")

    # Género principal para todas las canciones
    genre = genre_other if default_genre == "_other" else default_genre
    if not genre:
        return HttpResponseBadRequest("Género obligatorio.")

    storage = _storage()

    # Leemos la portada una sola vez para reutilizarla en todas las canciones
    cover_bytes = None
    cover_suffix = ""
    if cover_file:
        try:
            cover_bytes = cover_file.read()
            try:
                cover_file.seek(0)
            except Exception:
                pass
            cover_suffix = Path(cover_file.name).suffix or ".jpg"
        except Exception:
            cover_bytes = None
            cover_suffix = ""

    results = []
    for f in files:
        ext = (Path(f.name).suffix.lower().lstrip(".") or "")
        if ext not in _ALLOWED_EXTS:
            results.append({"name": f.name, "ok": False, "error": "Extensión no permitida"})
            continue

        if getattr(f, "size", 0) > _MAX_FILE_SIZE:
            results.append(
                {
                    "name": f.name,
                    "ok": False,
                    "error": f"Archivo excede {int(_MAX_FILE_SIZE/1024/1024)} MB",
                }
            )
            continue

        # Proponemos un título a partir del nombre del archivo
        candidate = _title_candidate_from_filename(f.name)
        ok_title, why = _title_is_sensible(candidate)
        if not ok_title:
            results.append(
                {
                    "name": f.name,
                    "ok": False,
                    "error": f"Nombre no válido para subida rápida ({why}).",
                }
            )
            continue

        # Calculamos hash para detectar duplicados de contenido
        try:
            sha = _sha256_file(f)
        except Exception:
            results.append({"name": f.name, "ok": False, "error": "No se pudo leer el archivo"})
            continue

        if Song.objects.filter(owner_user=username, audio_sha256=sha, visibility="public").exists():
            results.append({"name": f.name, "ok": False, "error": "Duplicado (mismo audio)"})
            continue

        title = candidate
        if Song.objects.filter(owner_user=username, visibility="public", title__iexact=title).exists():
            results.append({"name": f.name, "ok": False, "error": "Duplicado (mismo título)"})
            continue

        try:
            with transaction.atomic():
                # Guardamos audio
                audio_path = storage.save(f"uploaded_songs/audio_{username}_{sha[:12]}.{ext}", f)

                # Si tenemos portada común, la escribimos una vez por canción
                cover_path = None
                if cover_bytes:
                    cf_name = f"uploaded_covers/cover_{username}_{sha[:12]}{cover_suffix or '.jpg'}"
                    cover_path = storage.save(cf_name, ContentFile(cover_bytes))

                s = Song.objects.create(
                    title=title,
                    artist_display_name=username,
                    genre=genre,
                    owner_user=username,
                    audio_file=audio_path,
                    cover_image=cover_path,
                    audio_sha256=sha,
                    visibility="public",
                )

            audio_url = _safe_file_url(s.audio_file)
            cover_url = _safe_file_url(s.cover_image)
            results.append(
                {
                    "name": f.name,
                    "ok": True,
                    "song": {
                        "id": s.id,
                        "title": s.title,
                        "artist_display_name": s.artist_display_name,
                        "genre": s.genre,
                        "audio_url": audio_url,
                        "cover_url": cover_url,
                        "created_at": s.created_at.isoformat(timespec="minutes")
                        if s.created_at
                        else "",
                    },
                }
            )
        except Exception as e:
            results.append({"name": f.name, "ok": False, "error": f"Error al guardar: {e}"})

    if _is_fetch(request):
        ok_any = any(r.get("ok") for r in results)
        return JsonResponse({"ok": ok_any, "results": results})

    # Navegación normal: comprimimos resultados en un mensaje resumen
    creadas = sum(1 for r in results if r.get("ok"))
    omitidas = len(results) - creadas
    messages.info(request, f"Subida masiva: {creadas} creadas, {omitidas} omitidas.")
    return redirect("muro_subida_masiva")


# =============================================================================
# Fragmento de playlists (UI)
# =============================================================================


@require_http_methods(["GET"])
def playlists_fragment(request):
    """
    Fragmento HTML para la sección de playlists del artista en el muro.

    Actualmente es solo un placeholder estático. La idea es que en el futuro
    se reemplace por una vista que liste playlists curadas asociadas al artista.
    """
    html = (
        '<div class="card" style="margin:0">'
        '<p class="muted">Playlists del artista (próximamente).</p>'
        "</div>"
    )
    return HttpResponse(html)

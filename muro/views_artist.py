# muro/views_artist.py
# ============================================================================
# Melodify — Vistas del muro de artista.
# Muro público/privado, CRUD de canciones, subida masiva, endpoints JSON
# y fragmentos HTML relacionados.
# ============================================================================

"""
Vistas del muro de artista: muro público/privado, gestión de canciones,
subida masiva y fragmentos de UI relacionados.

Centraliza la lógica de negocio del muro para que el resto de la aplicación
consuma estos endpoints de forma consistente.
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
from django.db.models import Count, Q

from django.contrib.contenttypes.models import ContentType
from django.http import (
    HttpResponse,
    HttpResponseBadRequest,
    JsonResponse,
)
from django.core.exceptions import FieldDoesNotExist
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_http_methods

from inicio_sesion import base as base
from inicio_sesion.auth_helpers import _get_user_role, _is_artist, _require_session_user
from inicio_sesion.models import (
    ArtistProfile,
    Song,
    Users,
    LikeMedia,
    PlayList,
    PlayListSong,
)

try:
    from inicio_sesion.models import FollowArtist
except Exception:
    FollowArtist = None

# Detecta los nombres de los FK en PlayListSong de forma tolerante
try:
    _PLS_PLAYLIST_FIELD = None
    _PLS_SONG_FIELD = None

    # FK hacia PlayList
    for fname in ("playlist", "idPlaylist", "idPlayList"):
        try:
            PlayListSong._meta.get_field(fname)
            _PLS_PLAYLIST_FIELD = fname
            break
        except FieldDoesNotExist:
            continue

    # FK hacia Song
    for fname in ("song", "idSong", "idCancion"):
        try:
            PlayListSong._meta.get_field(fname)
            _PLS_SONG_FIELD = fname
            break
        except FieldDoesNotExist:
            continue
except Exception:
    _PLS_PLAYLIST_FIELD = None
    _PLS_SONG_FIELD = None

# =============================================================================
# Configuración / constantes
# =============================================================================

# Máximo de archivos permitidos en la subida masiva
_MAX_FILES = 30

# Tamaño máximo de cada archivo de audio (20 MB)
_MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB

# Extensiones de audio permitidas en la subida masiva
_ALLOWED_EXTS = {"mp3", "wav", "ogg", "m4a", "flac"}

# Filtro estricto de títulos
STRICT_TITLE_FILTER = True

# Longitud máxima permitida para los títulos de canción
MAX_SONG_TITLE_LEN = 27


# =============================================================================
# Helpers generales
# =============================================================================


def _is_fetch(request) -> bool:
    """
    Indica si la petición fue enviada por fetch/AJAX.

    Acepta:
    - X-Requested-With: fetch
    - X-Requested-With: XMLHttpRequest
    - X-Requested-With: ajax
    """
    xrw = (request.headers.get("X-Requested-With") or "").lower()
    return xrw in {"fetch", "xmlhttprequest", "ajax"}


def _redirect_login_clean(request):
    """
    Limpia mensajes pendientes y redirige al login.
    """
    for _ in messages.get_messages(request):
        pass
    return redirect("login")


def _storage():
    """
    Devuelve el storage configurado para archivos de audio/portadas.
    """
    return getattr(base, "_AUDIO_STORAGE", default_storage)


def _safe_file_url(field) -> str:
    """
    Devuelve una URL segura para un FileField/ImageField.
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


def _song_to_dict(song: Song) -> dict:
    """
    Convierte una instancia de Song en un dict para JSON/JS,
    incluyendo alias usados en otras vistas/JS.
    """
    artist_name = getattr(song, "artist_display_name", "") or ""
    audio_url = _safe_file_url(getattr(song, "audio_file", None)) or ""
    cover_url = _safe_file_url(getattr(song, "cover_image", None)) or ""

    return {
        "id": song.id,
        "title": song.title,
        "artist_display_name": artist_name,
        "author": artist_name,  # alias usado en templates/JS

        "audioUrl": audio_url,
        "audio_url": audio_url,  # alias legacy

        "coverUrl": cover_url,
        "cover_url": cover_url,  # alias legacy

        "genre": getattr(song, "genre", "") or "",
    }


def _delete_storage_entry(file_or_url) -> None:
    """
    Elimina una entrada del storage a partir del FileField o de su nombre/URL.
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
        pass


def _delete_song_files(song: Song) -> None:
    """
    Elimina del storage los archivos asociados a una canción.
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
    """
    try:
        user = Users.objects.get(user=username)
        return user.artist_profile
    except (Users.DoesNotExist, ArtistProfile.DoesNotExist):
        return None


def _collect_song_likes_for_muro(songs, session_username: str | None):
    """
    Anota en cada Song:
      - s.is_liked
      - s.likes_count

    Devuelve estadísticas agregadas.
    """
    if not songs:
        return {"total_likes": 0, "user_liked_songs": 0, "user_liked_ids": set()}

    ct_song = ContentType.objects.get_for_model(Song)
    song_ids = [s.id for s in songs]

    likes_qs = LikeMedia.objects.filter(
        content_type=ct_song,
        object_id__in=song_ids,
    )

    counts_by_song = {
        row["object_id"]: row["c"]
        for row in likes_qs.values("object_id").annotate(c=Count("id"))
    }

    user_liked_ids: set[int] = set()
    if session_username:
        user_liked_ids = set(
            likes_qs.filter(user__user=session_username)
            .values_list("object_id", flat=True)
        )

    total_likes = 0
    for s in songs:
        song_likes = counts_by_song.get(s.id, 0)
        s.likes_count = song_likes
        s.is_liked = s.id in user_liked_ids
        total_likes += song_likes

    return {
        "total_likes": total_likes,
        "user_liked_songs": len(user_liked_ids),
        "user_liked_ids": user_liked_ids,
    }


def _collect_follow_stats_for_artist(artist_user: Users, session_username: str | None):
    """
    Devuelve estadísticas de seguidores para el muro del artista.
    """
    if not FollowArtist or not artist_user:
        return {"followers": 0, "is_following": False}

    try:
        followers_qs = FollowArtist.objects.filter(artist=artist_user)
        followers_count = followers_qs.count()

        is_following = False
        if session_username:
            is_following = followers_qs.filter(
                follower__user=session_username
            ).exists()

        return {"followers": followers_count, "is_following": is_following}
    except Exception:
        return {"followers": 0, "is_following": False}


def _build_likes_playlist_for_username(username: str, limit_to_songs=None):
    """
    Construye una playlist virtual "Music that i love" a partir de los likes
    de un usuario. Puede limitarse a una lista concreta de canciones.
    """
    if not username:
        return None

    try:
        ct_song = ContentType.objects.get_for_model(Song)
    except Exception:
        return None

    liked_qs = LikeMedia.objects.filter(
        content_type=ct_song,
        user__user=username,
    )

    if limit_to_songs:
        song_ids = [s.id for s in limit_to_songs]
        liked_qs = liked_qs.filter(object_id__in=song_ids)

    liked_ids = list(liked_qs.values_list("object_id", flat=True))
    if not liked_ids:
        return None

    liked_songs_qs = Song.objects.filter(
        id__in=liked_ids,
        visibility="public",
    ).only(
        "id",
        "title",
        "artist_display_name",
        "audio_file",
        "cover_image",
        "genre",
    )

    liked_songs: list[dict] = []
    for s in liked_songs_qs:
        data = _song_to_dict(s)
        if not data["audioUrl"]:
            continue
        liked_songs.append(data)

    if not liked_songs:
        return None

    return {
        "id": f"pl:likes:{username}",
        "name": "Music that i love",
        "songs_count": len(liked_songs),
        "songs": liked_songs,
    }


# =============================================================================
# Heurísticas de título / hash
# =============================================================================

_GUID_RE = re.compile(r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$", re.I)
_HEX_LONG_RE = re.compile(r"[0-9a-f]{16,}", re.I)
_B64ISH_RE = re.compile(r"^[A-Za-z0-9+/]{24,}={0,2}$")

_WORD_CHARS = "a-záéíóúñü"
_VOWELS = "aeiouáéíóú"


def _normalize_base(filename: str) -> str:
    base = os.path.splitext(filename)[0]
    base = re.sub(r"[_\-\.]+", " ", base)
    base = re.sub(r"\s+", " ", base).strip()
    return base


def _clean_title(filename: str) -> str:
    name = os.path.splitext(filename)[0]
    name = re.sub(r"^\s*\d+[)\-._\s]+", "", name)
    name = name.replace("_", " ").replace("-", " ").strip()
    return name or "Nueva canción"


def _title_candidate_from_filename(filename: str) -> str:
    return _normalize_base(_clean_title(filename))


def _looks_random(name: str) -> bool:
    if _GUID_RE.fullmatch(name):
        return True
    if _HEX_LONG_RE.search(name):
        return True
    if _B64ISH_RE.fullmatch(name):
        return True
    return False


def _title_is_sensible(title: str) -> tuple[bool, str]:
    if not STRICT_TITLE_FILTER:
        return True, ""

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
    long_words = [
        t
        for t in tokens
        if re.fullmatch(rf"[{_WORD_CHARS}]{{3,}}", t, flags=re.I)
    ]
    if not long_words:
        return False, "no contiene palabras reconocibles"

    if len(title) > MAX_SONG_TITLE_LEN:
        return False, f"demasiado largo (máx. {MAX_SONG_TITLE_LEN} caracteres)"

    return True, ""


def _sha256_file(django_file) -> str:
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
    Muro público de un artista con secciones de likes, seguidores y playlists.
    """
    # Buscar artista
    artist_user = Users.objects.filter(
        user=username,
        type__iexact="artista",
    ).first()

    # Artista no encontrado: responde 404 con plantilla específica
    if not artist_user:
        session_user = request.session.get("user", "")
        session_role = request.session.get("role", "")
        role_lower = (session_role or "").lower()

        session_avatar_url = ""
        session_artist_desc = ""
        session_created_at = None

        if session_user:
            try:
                u = Users.objects.get(user=session_user)
                if getattr(u, "avatar", None):
                    session_avatar_url = _safe_file_url(u.avatar)
                if getattr(u, "created_at", None):
                    session_created_at = u.created_at
                if role_lower == "artista":
                    try:
                        session_artist_desc = (
                            u.artist_profile.description or ""
                        ).strip()
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
        return render(
            request,
            "muro/artista_no_encontrado.html",
            ctx,
            status=404,
        )

    # Descripción del muro y canciones públicas
    try:
        prof = artist_user.artist_profile
        wall_description = (prof.description or "").strip()
    except ArtistProfile.DoesNotExist:
        wall_description = ""

    songs_qs = Song.objects.filter(
        owner_user=username,
        visibility="public",
    ).only(
        "id",
        "title",
        "artist_display_name",
        "created_at",
        "cover_image",
        "audio_file",
        "genre",
    )
    songs = list(songs_qs)

    # Datos de sesión para header
    session_user = request.session.get("user", "")
    session_role = request.session.get("role", "")
    role_lower = (session_role or "").lower()

    session_avatar_url = ""
    session_artist_desc = ""
    session_created_at = None

    if session_user:
        try:
            u = Users.objects.get(user=session_user)
            if getattr(u, "avatar", None):
                session_avatar_url = _safe_file_url(u.avatar)
            if getattr(u, "created_at", None):
                session_created_at = u.created_at
            if role_lower == "artista":
                try:
                    session_artist_desc = (
                        u.artist_profile.description or ""
                    ).strip()
                except ArtistProfile.DoesNotExist:
                    session_artist_desc = ""
        except Users.DoesNotExist:
            pass

    # Likes y seguidores
    like_stats = _collect_song_likes_for_muro(songs, session_user or None)
    likes_for_js = [
        {"id": s.id}
        for s in songs
        if getattr(s, "is_liked", False)
    ]

    follow_stats = _collect_follow_stats_for_artist(
        artist_user, session_user or None
    )

    # Playlist "Mi música" (artista logueado)
    playlists = []
    if role_lower == "artista" and session_user:
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

    # Datos de undo del muro
    undo_muro_data = request.session.get("mi_muro_undo")
    if undo_muro_data and undo_muro_data.get("owner") != session_user:
        undo_muro_data = None
    undo_muro_label = (
        request.session.get("mi_muro_undo_label") if undo_muro_data else None
    )

    # Playlists públicas del artista + "Music that i love"
    artist_public_playlists: list[dict] = []
    artist_likes_playlist: dict | None = None

    # Playlists públicas del artista
    try:
        id_user_field = PlayList._meta.get_field("idUser")
    except Exception:
        id_user_field = None

    artist_playlists_qs = PlayList.objects.none()
    try:
        if id_user_field is not None:
            from django.db.models import (
                ForeignKey,
                OneToOneField,
                IntegerField,
                BigIntegerField,
                AutoField,
                CharField,
            )

            if isinstance(id_user_field, (ForeignKey, OneToOneField)):
                artist_playlists_qs = PlayList.objects.filter(idUser=artist_user)
            elif isinstance(id_user_field, (IntegerField, BigIntegerField, AutoField)):
                artist_playlists_qs = PlayList.objects.filter(idUser=artist_user.id)
            elif isinstance(id_user_field, CharField):
                artist_playlists_qs = PlayList.objects.filter(idUser=artist_user.user)

        artist_playlists_qs = artist_playlists_qs.exclude(isprivate=True).only(
            "id",
            "name",
        )
    except Exception:
        artist_playlists_qs = PlayList.objects.none()
    try:
        ct_playlist = ContentType.objects.get_for_model(PlayList)
    except Exception:
        ct_playlist = None

    for pl in artist_playlists_qs:
        # Canciones de esta playlist
        try:
            playlist_songs = PlayListSong.objects.filter(
                playlist_id=pl.id
            ).order_by("position")
        except Exception:
            playlist_songs = PlayListSong.objects.none()

        song_ids = [ps.song_id for ps in playlist_songs]

        pl_songs: list[dict] = []
        if song_ids:
            songs_qs = Song.objects.filter(
                id__in=song_ids,
                visibility="public",
            ).only(
                "id",
                "title",
                "artist_display_name",
                "genre",
                "audio_file",
                "cover_image",
            )

            # Mapa para respetar el orden definido en PlayListSong
            songs_map = {s.id: s for s in songs_qs}

            for ps in playlist_songs:
                s = songs_map.get(ps.song_id)
                if not s:
                    continue

                data = _song_to_dict(s)
                if not data["audioUrl"]:
                    continue

                pl_songs.append(data)

        # Likes de la playlist
        likes_count = 0
        if ct_playlist is not None:
            try:
                likes_count = LikeMedia.objects.filter(
                    content_type=ct_playlist,
                    object_id=pl.id,
                ).count()
            except Exception:
                likes_count = 0

        artist_public_playlists.append(
            {
                "id": pl.id,
                "name": pl.name,
                "songs_count": len(pl_songs),
                "likes_count": likes_count,
                "songs": pl_songs,
            }
        )

    # Playlist "Music that i love"
    artist_likes_playlist = _build_likes_playlist_for_username(
        artist_user.user,
        limit_to_songs=None,
    )

    # Si el artista no tiene gustos, se usan los del usuario de sesión
    # limitados a canciones de este muro.
    if not artist_likes_playlist and session_user:
        artist_likes_playlist = _build_likes_playlist_for_username(
            session_user,
            limit_to_songs=songs,
        )

    # Contexto final
    ctx = {
        "artist": artist_user,
        "description": wall_description,
        "songs": songs,
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
        "likes_json": json.dumps(likes_for_js, ensure_ascii=False),
        "muro_total_likes": like_stats.get("total_likes", 0),
        "muro_user_liked_songs": like_stats.get("user_liked_songs", 0),
        "muro_followers_count": follow_stats.get("followers", 0),
        "is_following_artist": follow_stats.get("is_following", False),
        # Playlists del artista
        "artist_public_playlists": artist_public_playlists,
        "artist_likes_playlist": artist_likes_playlist,
        "artist_public_playlists_json": json.dumps(
            artist_public_playlists, ensure_ascii=False
        ),
        "artist_likes_playlist_json": json.dumps(
            artist_likes_playlist or {}, ensure_ascii=False
        ),
        # Alias para compatibilidad con JS/plantillas antiguos
        "artist_playlists": artist_public_playlists,
        "artist_playlists_json": json.dumps(
            artist_public_playlists, ensure_ascii=False
        ),
        "music_that_i_love": artist_likes_playlist,
        "music_that_i_love_json": json.dumps(
            artist_likes_playlist or {}, ensure_ascii=False
        ),
    }

    return render(request, "muro/muro_artista.html", ctx)


@require_http_methods(["GET"])
def mi_muro(request):
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
    Subida de una canción desde el muro del artista.
    """
    username = _require_session_user(request)
    if not username:
        return _redirect_login_clean(request)
    if not _is_artist(_get_user_role(username)):
        return HttpResponse("No autorizado", status=403)
    is_fetch = _is_fetch(request)

    def _json_err(msg, status=400):
        return JsonResponse({"ok": False, "error": msg}, status=status)

    title = (request.POST.get("title") or "").strip()
    genre = (request.POST.get("genre") or "").strip()
    audio = request.FILES.get("audio_file")
    cover = request.FILES.get("cover_image")

    artist_display_name = username

    # Título
    if not title:
        if audio:
            candidate = _title_candidate_from_filename(audio.name)
            ok_title, why = _title_is_sensible(candidate)
            if ok_title:
                title = candidate
            else:
                msg = f"Título inválido ({why})."
                return _json_err(msg) if is_fetch else _redirect_error(
                    request, msg, "mi_muro"
                )
        else:
            msg = "Título requerido"
            return _json_err(msg) if is_fetch else _redirect_error(
                request, msg, "mi_muro"
            )
    else:
        ok_title, why = _title_is_sensible(title)
        if not ok_title:
            msg = f"Título no válido ({why})."
            return _json_err(msg) if is_fetch else _redirect_error(
                request, msg, "mi_muro"
            )

    # Audio obligatorio
    if audio is None:
        msg = "El archivo de audio es obligatorio."
        return _json_err(msg) if is_fetch else _redirect_error(
            request, msg, "mi_muro"
        )

    # Duplicados / límites
    if Song.objects.filter(
        owner_user=username, visibility="public", title__iexact=title
    ).exists():
        msg = "Ya tienes una canción con ese título."
        return _json_err(msg) if is_fetch else _redirect_error(
            request, msg, "mi_muro"
        )

    if getattr(audio, "size", 0) > _MAX_FILE_SIZE:
        msg = f"El archivo excede {int(_MAX_FILE_SIZE/1024/1024)} MB."
        return _json_err(msg) if is_fetch else _redirect_error(
            request, msg, "mi_muro"
        )

    audio_digest = _sha256_file(audio)
    if audio_digest and Song.objects.filter(
        owner_user=username, visibility="public", audio_sha256=audio_digest
    ).exists():
        msg = "Ya subiste este mismo audio antes."
        return _json_err(msg) if is_fetch else _redirect_error(
            request, msg, "mi_muro"
        )

    storage = _storage()
    try:
        audio_ext = Path(audio.name).suffix or ""
        audio_name = f"uploaded_songs/audio_{username}_{uuid4().hex}{audio_ext}"

        cover_name = None
        if cover:
            cover_ext = Path(cover.name).suffix or ""
            cover_name = f"uploaded_covers/cover_{username}_{uuid4().hex}{cover_ext}"

        with transaction.atomic():
            saved_audio = storage.save(audio_name, audio)
            saved_cover = storage.save(cover_name, cover) if cover_name else None

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
                        "created_at": (
                            song.created_at.isoformat()
                            if song.created_at
                            else ""
                        ),
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
        return _json_err(msg) if is_fetch else _redirect_error(
            request, msg, "mi_muro"
        )
    except Exception:
        msg = "Error al subir la canción."
        return _json_err(msg) if is_fetch else _redirect_error(
            request, msg, "mi_muro"
        )


def _redirect_error(request, msg: str, to_name: str):
    """
    Registra un mensaje de error y redirige a una vista nombrada.
    """
    if not _is_fetch(request):
        messages.error(request, msg)
    return redirect(to_name)


def _put_undo_muro(request, label: str, data: dict) -> None:
    """
    Guarda datos de undo para operaciones en el muro del artista.
    """
    request.session["mi_muro_undo"] = data
    request.session["mi_muro_undo_label"] = label
    request.session.modified = True


def _clear_undo_muro(request) -> None:
    """
    Limpia los datos de undo del muro del artista.
    """
    request.session.pop("mi_muro_undo", None)
    request.session.pop("mi_muro_undo_label", None)
    request.session.modified = True


@require_http_methods(["GET", "POST"])
def editar_mi_cancion_en_muro(request, song_id: int):
    """
    Edición de una canción del muro del artista.
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

        ok_title, why = _title_is_sensible(new_title)
        if not ok_title:
            if not _is_fetch(request):
                messages.error(request, f"Título no válido ({why}).")
            return redirect("editar_mi_cancion_en_muro", song_id=song.id)

        try:
            storage = _storage()
            with transaction.atomic():
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
                        messages.error(
                            request, "Ya tienes otra canción con ese título."
                        )
                    return redirect(
                        "editar_mi_cancion_en_muro", song_id=song.id
                    )

                song.title = new_title
                song.genre = new_genre

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

                song.save(update_fields=["title", "cover_image", "genre"])

            if not _is_fetch(request):
                messages.success(request, "Cambios guardados.")
            return redirect("mi_muro")
        except Exception:
            if not _is_fetch(request):
                messages.error(
                    request, "No se pudieron guardar los cambios."
                )
            return redirect("editar_mi_cancion_en_muro", song_id=song.id)

    return render(request, "muro/editar_mi_cancion.html", {"song": song})


@require_http_methods(["POST"])
def eliminar_cancion(request, song_id: int):
    """
    Marca una canción como eliminada desde el muro del artista.
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
        return JsonResponse(
            {"ok": True, "undo_label": f"Se eliminó “{song.title}”."}
        )
    return redirect("mi_muro")


@require_http_methods(["POST"])
def revertir_mi_cancion(request):
    """
    Revierte la última acción de subir/eliminar canción en el muro del artista.
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


def _put_undo_gestion(request, label: str, data: dict) -> None:
    """
    Guarda datos de undo para operaciones desde Gestión.
    """
    request.session["gestion_undo"] = data
    request.session["gestion_undo_label"] = label
    request.session.modified = True


@require_http_methods(["GET", "POST"])
def subir_cancion(request):
    """
    Proxy hacia subir_cancion_en_muro. Acepta GET (redirige) y POST.
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
    Devuelve en JSON las canciones públicas del usuario autenticado.
    """
    if "user" not in request.session:
        return JsonResponse({"ok": False, "error": "auth"}, status=401)

    username = request.session.get("user", "")
    qs = Song.objects.filter(owner_user=username, visibility="public").only(
        "id",
        "title",
        "artist_display_name",
        "audio_file",
        "cover_image",
        "visibility",
        "genre",
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
        return HttpResponseBadRequest(
            f"Máximo permitido: {_MAX_FILES} archivos."
        )

    genre = genre_other if default_genre == "_other" else default_genre
    if not genre:
        return HttpResponseBadRequest("Género obligatorio.")

    storage = _storage()

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
            results.append(
                {"name": f.name, "ok": False, "error": "Extensión no permitida"}
            )
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

        try:
            sha = _sha256_file(f)
        except Exception:
            results.append(
                {"name": f.name, "ok": False, "error": "No se pudo leer el archivo"}
            )
            continue

        if Song.objects.filter(
            owner_user=username, audio_sha256=sha, visibility="public"
        ).exists():
            results.append(
                {
                    "name": f.name,
                    "ok": False,
                    "error": "Duplicado (mismo audio)",
                }
            )
            continue

        title = candidate
        if Song.objects.filter(
            owner_user=username, visibility="public", title__iexact=title
        ).exists():
            results.append(
                {
                    "name": f.name,
                    "ok": False,
                    "error": "Duplicado (mismo título)",
                }
            )
            continue

        try:
            with transaction.atomic():
                audio_path = storage.save(
                    f"uploaded_songs/audio_{username}_{sha[:12]}.{ext}", f
                )

                cover_path = None
                if cover_bytes:
                    cf_name = (
                        f"uploaded_covers/cover_{username}_{sha[:12]}"
                        f"{cover_suffix or '.jpg'}"
                    )
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
            results.append(
                {
                    "name": f.name,
                    "ok": False,
                    "error": f"Error al guardar: {e}",
                }
            )

    if _is_fetch(request):
        ok_any = any(r.get("ok") for r in results)
        return JsonResponse({"ok": ok_any, "results": results})

    creadas = sum(1 for r in results if r.get("ok"))
    omitidas = len(results) - creadas
    messages.info(request, f"Subida masiva: {creadas} creadas, {omitidas} omitidas.")
    return redirect("muro_subida_masiva")


@require_http_methods(["GET", "POST"])
def subida_masiva_admin_para_artista(request, artist_username: str):
    """
    Subida masiva desde Gestión para cargar canciones a un artista.
    """
    session_username = _require_session_user(request)
    if not session_username:
        return _redirect_login_clean(request)

    role = (_get_user_role(session_username) or "").lower()
    if role != "administrador":
        return HttpResponse("No autorizado", status=403)

    artist_user = Users.objects.filter(
        user=artist_username,
        type__iexact="artista",
    ).first()
    if not artist_user:
        return HttpResponse("Artista no encontrado", status=404)

    is_fetch = _is_fetch(request)

    if request.method == "GET":
        return render(
            request,
            "muro/subida_masiva_admin.html",
            {
                "target_artist": artist_user,
                "MAX_FILES": _MAX_FILES,
                "MAX_MB": int(_MAX_FILE_SIZE / 1024 / 1024),
            },
        )

    files = request.FILES.getlist("audio_files")
    default_genre = (request.POST.get("genre") or "").strip()
    genre_other = (request.POST.get("genre_other") or "").strip()
    cover_file = request.FILES.get("cover_image")

    def _err(msg, status=400):
        if is_fetch:
            return JsonResponse({"ok": False, "error": msg}, status=status)
        messages.error(request, msg)
        return redirect(request.path)

    if not files:
        return _err("No se enviaron archivos de audio.")
    if len(files) > _MAX_FILES:
        return _err(f"Máximo permitido por subida: {_MAX_FILES} archivos.")

    genre = genre_other if default_genre == "_other" else default_genre
    if not genre:
        return _err("El género es obligatorio para la subida masiva.")

    storage = _storage()

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

    target_username = artist_user.user

    results = []
    for f in files:
        ext = (Path(f.name).suffix.lower().lstrip(".") or "")
        if ext not in _ALLOWED_EXTS:
            results.append(
                {"name": f.name, "ok": False, "error": "Extensión no permitida"}
            )
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

        try:
            sha = _sha256_file(f)
        except Exception:
            results.append(
                {"name": f.name, "ok": False, "error": "No se pudo leer el archivo"}
            )
            continue

        if Song.objects.filter(
            owner_user=target_username,
            audio_sha256=sha,
            visibility="public",
        ).exists():
            results.append(
                {
                    "name": f.name,
                    "ok": False,
                    "error": "Duplicado (mismo audio para este artista)",
                }
            )
            continue

        title = candidate
        if Song.objects.filter(
            owner_user=target_username,
            visibility="public",
            title__iexact=title,
        ).exists():
            results.append(
                {
                    "name": f.name,
                    "ok": False,
                    "error": "Duplicado (mismo título para este artista)",
                }
            )
            continue

        try:
            with transaction.atomic():
                audio_path = storage.save(
                    f"uploaded_songs/audio_{target_username}_{sha[:12]}.{ext}",
                    f,
                )

                cover_path = None
                if cover_bytes:
                    cf_name = (
                        f"uploaded_covers/cover_{target_username}_{sha[:12]}"
                        f"{cover_suffix or '.jpg'}"
                    )
                    cover_path = storage.save(cf_name, ContentFile(cover_bytes))

                s = Song.objects.create(
                    title=title,
                    artist_display_name=target_username,
                    genre=genre,
                    owner_user=target_username,
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
            results.append(
                {
                    "name": f.name,
                    "ok": False,
                    "error": f"Error al guardar: {e}",
                }
            )

    created_ids = [
        r["song"]["id"]
        for r in results
        if r.get("ok") and isinstance(r.get("song"), dict) and r["song"].get("id")
    ]
    creadas = len(created_ids)
    undo_label = ""
    if creadas:
        undo_label = (
            f"Se sembraron {creadas} canción"
            f"{'' if creadas == 1 else 'es'} para {artist_username}."
        )
        _put_undo_gestion(
            request,
            undo_label,
            {
                "kind": "admin_seed_songs",
                "artist_username": artist_username,
                "song_ids": created_ids,
                "actor": session_username,
            },
        )

    if is_fetch:
        return JsonResponse(
            {
                "ok": creadas > 0,
                "results": results,
                "undo_label": undo_label,
            }
        )

    return redirect("gestion")


@require_http_methods(["POST"])
def toggle_follow_artist(request, username: str):
    """
    Activa/desactiva seguir a un artista para el usuario autenticado.
    """
    if not FollowArtist:
        return JsonResponse(
            {"ok": False, "error": "follow_not_available"},
            status=400,
        )

    session_username = request.session.get("user", "")
    if not session_username:
        return JsonResponse({"ok": False, "error": "auth"}, status=401)

    if session_username == username:
        return JsonResponse({"ok": False, "error": "no_self_follow"}, status=400)

    artist_user = Users.objects.filter(
        user=username,
        type__iexact="artista",
    ).first()
    if not artist_user:
        return JsonResponse({"ok": False, "error": "artist_not_found"}, status=404)

    follower = Users.objects.filter(user=session_username).first()
    if not follower:
        return JsonResponse({"ok": False, "error": "auth"}, status=401)

    try:
        obj, created = FollowArtist.objects.get_or_create(
            follower=follower,
            artist=artist_user,
        )
        if created:
            following = True
        else:
            obj.delete()
            following = False

        followers = FollowArtist.objects.filter(artist=artist_user).count()
    except Exception:
        return JsonResponse({"ok": False, "error": "server"}, status=500)

    return JsonResponse(
        {"ok": True, "following": following, "followers": followers},
        status=200,
    )


@require_http_methods(["GET"])
def artist_followers_fragment(request, username: str):
    """
    Fragmento HTML con la lista de seguidores de un artista.
    """
    if not FollowArtist:
        return HttpResponse(
            '<p class="muted" style="margin:0;">Seguidores no disponibles.</p>'
        )

    artist_user = Users.objects.filter(
        user=username,
        type__iexact="artista",
    ).first()
    if not artist_user:
        return HttpResponse(
            '<p class="muted" style="margin:0;">Artista no encontrado.</p>',
            status=404,
        )

    followers_qs = (
        FollowArtist.objects
        .filter(artist=artist_user)
        .select_related("follower")
        .order_by("follower__user")
    )

    parts = [
        '<div class="card" style="margin:8px 0 0;">',
        '<h4 style="margin:0 0 8px;">Seguidores</h4>',
    ]

    if not followers_qs.exists():
        parts.append(
            '<p class="muted" style="margin:0;">Este artista aún no tiene seguidores.</p>'
        )
    else:
        parts.append('<ul class="simple-list" style="margin:0; padding-left:18px;">')
        for rel in followers_qs:
            u = rel.follower
            uname = getattr(u, "user", "") or ""
            display = getattr(u, "name", "") or uname
            parts.append(
                f"<li>{display} <span class='muted'>@{uname}</span></li>"
            )
        parts.append("</ul>")

    parts.append("</div>")
    return HttpResponse("".join(parts))


# =============================================================================
# Fragmento de playlists (UI)
# =============================================================================


@require_http_methods(["GET"])
def playlists_fragment(request):
    """
    Fragmento HTML para la sección de playlists del artista en el muro.
    """
    html = (
        '<div class="card" style="margin:0">'
        '<p class="muted">Playlists del artista (próximamente).</p>'
        "</div>"
    )
    return HttpResponse(html)

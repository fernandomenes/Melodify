# inicio_sesion/views_likes.py
"""
Vistas JSON para togglear likes de canciones y playlists.

Se apoyan en el modelo Users almacenado en sesión y en LikeMedia
como tabla genérica de likes (ContentType + object_id).
"""

from django.contrib.contenttypes.models import ContentType
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_POST

from .models import LikeMedia, PlayList, Song, Users


# ======================================================================
# Helper para obtener el usuario logueado (modelo Users)
# ======================================================================


def _get_current_user(request):
    """
    Devuelve la instancia de Users asociada a la sesión actual o None.

    Se basa en request.session["user"] y exige que el usuario esté activo.
    """
    username = request.session.get("user")
    if not username:
        return None
    try:
        return Users.objects.get(user=username, is_active=True)
    except Users.DoesNotExist:
        return None


# ======================================================================
# /api/like/song/<song_id>/  (toggle like de canciones)
# ======================================================================


@require_POST
def api_toggle_like_song(request, song_id: int):
    """
    Alterna el like de una canción pública para el usuario actual.

    - Requiere sesión iniciada.
    - Sólo considera canciones con visibility="public".
    - Devuelve estado actual del like y número total de likes.
    """
    user = _get_current_user(request)
    if not user:
        return JsonResponse({"ok": False, "error": "login_required"}, status=401)

    song = get_object_or_404(Song, id=song_id, visibility="public")
    ct_song = ContentType.objects.get_for_model(Song)

    like_obj, created = LikeMedia.objects.get_or_create(
        user=user,
        content_type=ct_song,
        object_id=song.id,
    )

    if created:
        liked = True
    else:
        # Ya existía → lo quitamos
        like_obj.delete()
        liked = False

    likes_count = LikeMedia.objects.filter(
        content_type=ct_song,
        object_id=song.id,
    ).count()

    return JsonResponse(
        {
            "ok": True,
            "song_id": song.id,
            "liked": liked,
            "likes_count": likes_count,
        }
    )


# ======================================================================
# /api/like/playlist/<playlist_id>/  (toggle like de playlists)
# ======================================================================


@require_POST
def api_toggle_like_playlist(request, playlist_id: int):
    """
    Alterna el like de una playlist para el usuario actual.

    - Requiere sesión iniciada.
    - PlayList es managed=False, pero sirve igual para ContentType.
    - Devuelve estado actual del like y número total de likes.
    """
    user = _get_current_user(request)
    if not user:
        return JsonResponse({"ok": False, "error": "login_required"}, status=401)

    # PlayList es managed=False, pero sirve igual para ContentType
    playlist = get_object_or_404(PlayList, id=playlist_id)
    ct_pl = ContentType.objects.get_for_model(PlayList)

    like_obj, created = LikeMedia.objects.get_or_create(
        user=user,
        content_type=ct_pl,
        object_id=playlist.id,
    )

    if created:
        liked = True
    else:
        like_obj.delete()
        liked = False

    likes_count = LikeMedia.objects.filter(
        content_type=ct_pl,
        object_id=playlist.id,
    ).count()

    return JsonResponse(
        {
            "ok": True,
            "playlist_id": playlist.id,
            "liked": liked,
            "likes_count": likes_count,
        }
    )

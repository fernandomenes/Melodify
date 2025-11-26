from django.urls import include, path
from . import views as v
from . import views_likes

urlpatterns = [
    path("", v.pantallaPrincipal, name="principal"),
    path("login/", v.pantallaLogin, name="login"),
    path("registro/", v.pantallaRegistro, name="registro"),
    path("home/", v.pantallaHome, name="home"),
    path("logout/", v.pantallaLogout, name="logout"),
    path("buscar/", v.buscar, name="buscar"),
    path("api/buscar/", v.api_buscar, name="api-buscar"),

    # Secciones
    path("gestion/", include("gestion.urls")),
    path("", include("muro.urls")),

    # Playlists
    path("playlist/getAllList/", v.playlist_getAll, name="getAllList"),
    path("playlist/create/", v.create_playlist, name="create-playlist"),
    path(
        "playlist/<int:playlist_id>/songs/",
        v.get_songs_by_playlist,
        name="getSongsByPl",
    ),
    path(
        "playlist/<int:playlist_id>/delete/",
        v.delete_playlist,
        name="delete-playlist",
    ),
    path(
        "playlist/<int:playlist_id>/update/",
        v.update_playlist,
        name="update-playlist",
    ),
    path("playlist/allsongs/", v.get_all_songs, name="get-all-songs"),
    path("playlist/addsong/", v.add_song_to_playlist, name="add-song-to-playlist"),
    path(
        "playlist/removeSong/",
        v.remove_song_from_playlist,
        name="remove-song-from-playlist",
    ),
    path("playlist/getuserid/", v.get_user_id, name="get_user_id"),
    path("playlist/setFollows/", v.setFollows, name="setFollows"),

    # Playlists virtuales / datos para el reproductor
    path("mis-likes/json/", v.mis_likes_json, name="mis_likes_json"),
    path("api/all-songs/", v.get_all_songs, name="all_songs_json"),
    path(
        "api/followed-artists/playlists/",
        v.followed_artists_playlists_json,
        name="followed_artists_playlists_json",
    ),

    path(
        "api/like/song/<int:song_id>/",
        views_likes.api_toggle_like_song,
        name="api_like_song",
    ),
    path(
        "api/like/playlist/<int:playlist_id>/",
        views_likes.api_toggle_like_playlist,
        name="api_like_playlist",
    ),

    # Colaboradores
    path(
        "playlist/<int:playlist_id>/collaborators/",
        v.playlist_collaborators_list,
        name="playlist_collaborators_list",
    ),
    path(
        "playlist/<int:playlist_id>/collaborators/add/",
        v.playlist_collaborator_add,
        name="playlist_collaborator_add",
    ),
    path(
        "playlist/collaborators/add/",
        v.playlist_collaborator_add,
        name="playlist_collaborator_add_global",
    ),
    path(
        "playlist/<int:playlist_id>/collaborators/remove/<int:user_id>/",
        v.playlist_collaborator_remove,
        name="playlist_collaborator_remove",
    ),
]

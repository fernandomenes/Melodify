# inicio_sesion/urls.py
from django.urls import include, path

from . import views as v

urlpatterns = [
    path("", v.pantallaPrincipal, name="principal"),
    path("login/", v.pantallaLogin, name="login"),
    path("registro/", v.pantallaRegistro, name="registro"),
    path("home/", v.pantallaHome, name="home"),
    path("logout/", v.pantallaLogout, name="logout"),
    path('buscar/', v.buscar, name='buscar'),
    path('api/buscar/', v.api_buscar, name='api-buscar'),

    # Secciones
    path("gestion/", include("gestion.urls")),
    path("", include("muro.urls")),

    # playlist
    path('playlist/getAllList/', v.playlist_getAll, name='getAllList'),
    path('playlist/create/', v.create_playlist, name='create-playlist'),
    path('playlist/<int:playlist_id>/songs/', v.get_songs_by_playlist, name="getSongsByPl"),
    path('playlist/<int:playlist_id>/delete/', v.delete_playlist, name='delete-playlist'),
    path('playlist/<int:playlist_id>/update/', v.update_playlist, name='update-playlist'),
    path('playlist/allsongs/', v.get_all_songs, name='get-all-songs'),
    path('playlist/addsong/', v.add_song_to_playlist, name='add-song-to-playlist'),
    path('playlist/removeSong/', v.remove_song_from_playlist, name='remove-song-from-playlist'),
    path("api/like/song/<int:song_id>/", v.like_song, name="api_like_song"),
    path("api/like/playlist/<int:playlist_id>/", v.like_playlist, name="api_like_playlist"),


]

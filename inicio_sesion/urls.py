# inicio_sesion/urls.py
from django.urls import include, path

from . import views as v

urlpatterns = [
    path("", v.pantallaPrincipal, name="principal"),
    path("login/", v.pantallaLogin, name="login"),
    path("registro/", v.pantallaRegistro, name="registro"),
    path("home/", v.pantallaHome, name="home"),
    path("logout/", v.pantallaLogout, name="logout"),
    # Secciones
    path("gestion/", include("gestion.urls")),
    path("", include("muro.urls")),
    # playlist
    path('playlist/getAllList/', v.playlist_getAll, name='getAllList'),
    path('playlist/insert/', v.playlist_insert, name='insert'),
    path('playlist/<int:playlist_id>/songs/', v.get_songs_by_playlist, name="getSongsByPl"),
]

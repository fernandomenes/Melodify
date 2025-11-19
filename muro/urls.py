# muro/urls.py
from django.urls import path

from . import views_artist as va
from gestion import views_music as vm  # vistas de operaciones masivas sobre canciones

urlpatterns = [
    # Muro público y propio
    path("artista/<str:username>/", va.muro_publico, name="muro_publico"),
    path("mi-muro/", va.mi_muro, name="mi_muro"),

    # Canciones (CRUD)
    path("mi-muro/subir/", va.subir_cancion_en_muro, name="subir_cancion_en_muro"),
    path(
        "mi-muro/cancion/<int:song_id>/editar/",
        va.editar_mi_cancion_en_muro,
        name="editar_mi_cancion_en_muro",
    ),
    path(
        "mi-muro/eliminar/<int:song_id>/",
        va.eliminar_cancion,
        name="eliminar_mi_cancion",
    ),

    # Operaciones de deshacer
    path("mi-muro/undo/", va.revertir_mi_cancion, name="revertir_mi_cancion"),

    # Endpoints JSON para el reproductor
    path("mi-musica/json/", va.mi_musica_json, name="mi_musica_json"),

    # Subida masiva de canciones
    path("mi-muro/subida-masiva/", va.subida_masiva, name="muro_subida_masiva"),

    # Eliminación múltiple de canciones (módulo de gestión)
    path(
        "mi-muro/canciones/eliminar-multiples/",
        vm.eliminar_canciones_bulk,
        name="muro_eliminar_canciones_multiples",
    ),

    # Fragmento HTML de playlists
    path(
        "mi-muro/playlists/fragment/",
        va.playlists_fragment,
        name="muro_playlists_fragment",
    ),

]

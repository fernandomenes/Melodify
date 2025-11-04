# muro/urls.py
from django.urls import path

from . import views_artist as va

urlpatterns = [
    path("artista/<str:username>/", va.muro_publico, name="muro_publico"),
    path("mi-muro/", va.mi_muro, name="mi_muro"),
    path("mi-muro/subir/", va.subir_cancion_en_muro, name="subir_cancion_en_muro"),
    path(
        "mi-muro/cancion/<int:song_id>/editar/",
        va.editar_mi_cancion_en_muro,
        name="editar_mi_cancion_en_muro",
    ),
    path("mi-muro/eliminar/<int:song_id>/", va.eliminar_cancion, name="eliminar_mi_cancion"),
    path("mi-muro/undo/", va.revertir, name="revertir"),
    # JSON usado por el reproductor/Home
    path("mi-musica/json/", va.mi_musica_json, name="mi_musica_json"),
]

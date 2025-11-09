# muro/urls.py
from django.urls import path
from gestion import views_music as vm
from . import views_artist as va

urlpatterns = [
    path("artista/<str:username>/", va.muro_publico, name="muro_publico"),
    path("mi-muro/", va.mi_muro, name="mi_muro"),
    path("mi-muro/subir/", va.subir_cancion_en_muro, name="subir_cancion_en_muro"),
    path("mi-muro/cancion/<int:song_id>/editar/", va.editar_mi_cancion_en_muro, name="editar_mi_cancion_en_muro"),
    path("mi-muro/eliminar/<int:song_id>/", vm.eliminar_cancion, name="eliminar_mi_cancion"),

    path("mi-muro/undo/", vm.revertir_mi_cancion, name="revertir_mi_cancion"),

    # JSON reproductor/Home
    path("mi-musica/json/", va.mi_musica_json, name="mi_musica_json"),
    path("mi-muro/subida-masiva/", va.subida_masiva, name="muro_subida_masiva"),
    path("canciones/eliminar-multiples/", vm.eliminar_canciones_bulk, name="muro_eliminar_canciones_multiples"),
]

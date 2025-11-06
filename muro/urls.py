# muro/urls.py
"""
Enrutamiento del módulo «muro».

Incluye:
- Vistas públicas (muro de artista).
- Área personal del artista (mi muro, subir/editar/eliminar).
- Endpoint JSON para integración con el reproductor/Home.
- Operaciones de eliminación masiva y deshacer (reuso de lógica en gestión).
"""

from django.urls import path

from . import views_artist as va
from .views_artist import subida_masiva
from gestion import views_music as vm

urlpatterns = [
    # ---------------------------------------------------------------------
    # Vistas públicas
    # ---------------------------------------------------------------------
    path("artista/<str:username>/", va.muro_publico, name="muro_publico"),

    # ---------------------------------------------------------------------
    # Área personal del artista
    # ---------------------------------------------------------------------
    path("mi-muro/", va.mi_muro, name="mi_muro"),
    path("mi-muro/subir/", va.subir_cancion_en_muro, name="subir_cancion_en_muro"),
    path(
        "mi-muro/cancion/<int:song_id>/editar/",
        va.editar_mi_cancion_en_muro,
        name="editar_mi_cancion_en_muro",
    ),
    path("mi-muro/eliminar/<int:song_id>/", va.eliminar_cancion, name="eliminar_mi_cancion"),
    path("mi-muro/undo/", va.revertir, name="revertir"),
    path("mi-muro/subida-masiva/", subida_masiva, name="muro_subida_masiva"),

    # ---------------------------------------------------------------------
    # API JSON / integración
    # ---------------------------------------------------------------------
    path("mi-musica/json/", va.mi_musica_json, name="mi_musica_json"),

    # ---------------------------------------------------------------------
    # Operaciones (eliminación múltiple y deshacer)
    # ---------------------------------------------------------------------
    path("canciones/eliminar-multiples/", vm.eliminar_canciones_bulk, name="muro_eliminar_canciones_multiples"),
    path("undo/", vm.revertir_mi_cancion, name="revertir_mi_cancion"),
]

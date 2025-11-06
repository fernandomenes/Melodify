# gestion/urls.py
"""
Enrutamiento del módulo «gestión» (panel de administración, usuarios, catálogo
y operaciones sobre canciones).
"""

from django.urls import path

from . import views as v
from . import views_music as vm

urlpatterns = [
    # ------------------------------------------------------------------
    # Panel y usuarios
    # ------------------------------------------------------------------
    path("", v.gestion_dashboard, name="gestion"),
    path("registrar-artista/", v.registrar_artista, name="registrar_artista"),
    path("registrar-admin/", v.registrar_admin, name="registrar_admin"),
    path("usuarios/desactivar/<str:username>/", v.desactivar_usuario, name="desactivar_usuario"),
    path("usuarios/activar/<str:username>/", v.activar_usuario, name="activar_usuario"),
    path("usuarios/editar/<str:username>/", v.editar_usuario, name="editar_usuario"),
    path("usuarios/eliminar/<str:username>/", v.eliminar_usuario, name="eliminar_usuario"),
    path("undo/", v.revertir_accion, name="revertir_accion"),

    # ------------------------------------------------------------------
    # Catálogo
    # ------------------------------------------------------------------
    path("catalogo/fragment/", v.catalogo_admin_fragment, name="catalogo_admin_fragment"),
    path("catalogo/json/", v.catalogo_admin_json, name="catalogo_admin_json"),

    # ------------------------------------------------------------------
    # Canciones (administración)
    # ------------------------------------------------------------------
    path("canciones/editar/<int:song_id>/", vm.editar_cancion, name="editar_cancion"),
    path("canciones/eliminar/<int:song_id>/", vm.eliminar_cancion, name="eliminar_cancion"),
    path("canciones/eliminar-multiples/", vm.eliminar_canciones_bulk, name="eliminar_canciones_bulk"),

    # ------------------------------------------------------------------
    # Deshacer en muro (reutiliza lógica de música)
    # ------------------------------------------------------------------
    path("muro/undo/", vm.revertir_mi_cancion, name="revertir_muro"),
]

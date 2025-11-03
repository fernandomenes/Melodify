from django.urls import path

from inicio_sesion.vistas import views_admin as vadm
from inicio_sesion.vistas import views_artist as va
from inicio_sesion.vistas import views_music as vm  # eliminar/editar canción

from . import views as v  # pantallas principal/home/login

urlpatterns = [
    # Público / sesión
    path("", v.pantallaPrincipal, name="principal"),
    path("login/", v.pantallaLogin, name="login"),
    path("home/", v.pantallaHome, name="home"),
    # Gestión (admin)
    path("gestion/", vadm.gestion_dashboard, name="gestion"),
    path(
        "gestion/registrar-artista/", vadm.registrar_artista, name="registrar_artista"
    ),
    path("gestion/registrar-admin/", vadm.registrar_admin, name="registrar_admin"),
    path(
        "gestion/usuarios/desactivar/<str:username>/",
        vadm.desactivar_usuario,
        name="desactivar_usuario",
    ),
    path(
        "gestion/usuarios/activar/<str:username>/",
        vadm.activar_usuario,
        name="activar_usuario",
    ),
    path(
        "gestion/usuarios/editar/<str:username>/",
        vadm.editar_usuario,
        name="editar_usuario",
    ),
    path(
        "gestion/usuarios/eliminar/<str:username>/",
        vadm.eliminar_usuario,
        name="eliminar_usuario",
    ),
    path("gestion/undo/", vadm.revertir_accion, name="revertir_accion"),
    # Catálogo (fragment + json) pestaña admin
    path(
        "gestion/catalogo/fragment/",
        vadm.catalogo_admin_fragment,
        name="catalogo_admin_fragment",
    ),
    path(
        "gestion/catalogo/json/", vadm.catalogo_admin_json, name="catalogo_admin_json"
    ),
    # Muro del artista
    path("artista/<str:username>/", va.muro_publico, name="muro_publico"),
    path("mi-muro/", va.mi_muro, name="mi_muro"),
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
    path("mi-muro/undo/", va.revertir, name="revertir"),
    # Acciones compartidas (admin o dueño)
    path("mi-musica/json/", va.mi_musica_json, name="mi_musica_json"),
    path(
        "eliminar-cancion/<int:song_id>/", vm.eliminar_cancion, name="eliminar_cancion"
    ),
    path("subir-cancion/", va.subir_cancion, name="subir_cancion"),  # compat tests
    # Música
    path("musica/editar/<int:song_id>/", vm.editar_cancion, name="editar_cancion"),
]

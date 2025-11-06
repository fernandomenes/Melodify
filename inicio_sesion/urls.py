# inicio_sesion/urls.py
from django.urls import include, path

from . import views as v

urlpatterns = [
    path("", v.pantallaPrincipal, name="principal"),
    path("login/", v.pantallaLogin, name="login"),
    path("home/", v.pantallaHome, name="home"),
    path("logout/", v.pantallaLogout, name="logout"), 
    # Secciones
    path("gestion/", include("gestion.urls")),
    path("", include("muro.urls")),
]

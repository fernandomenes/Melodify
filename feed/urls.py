# feed/urls.py
"""
Enrutamiento de la aplicación «feed».

Endpoints
---------
- /feed/songs/changes/ : API JSON para notificar cambios de canciones (polling).
"""

from django.urls import path

from . import views

app_name = "feed"

urlpatterns = [
    path("songs/changes/", views.songs_changes, name="songs_changes"),
]

# reproductor/urls.py
from django.urls import path
from .views_stream import stream_uploaded_media

urlpatterns = [
    # CDN interno con soporte Range
    path("u/<path:relpath>", stream_uploaded_media, name="stream_uploaded_media"),
]

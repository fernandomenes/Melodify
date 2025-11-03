"""URL raíz de Melodify: media/estáticos (dev) y rutas de la app."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path

from inicio_sesion.vistas.views_stream import stream_uploaded_media

urlpatterns = [
    re_path(
        r"^uploaded_media/(?P<relpath>.+)$",
        stream_uploaded_media,
        name="uploaded_media_range",
    ),
    path("", include("inicio_sesion.urls")),
    path("admin/", admin.site.urls),
]

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)

"""
Enrutamiento raíz de Melodify: mapeo de rutas de aplicaciones, favicon y entrega
de archivos subidos con compatibilidad de rangos.
"""

from pathlib import Path

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import FileResponse, Http404
from django.urls import include, path, re_path

from reproductor.views_stream import stream_uploaded_media


def favicon_root(request):
    """Entrega del favicon desde la raíz del proyecto."""
    f = Path(settings.BASE_DIR) / "favicon.ico"
    if not f.exists():
        raise Http404()
    return FileResponse(open(f, "rb"), content_type="image/x-icon")


urlpatterns = [
    # Entrega de archivos subidos con soporte para rangos HTTP (streaming)
    re_path(
        r"^uploaded_media/(?P<relpath>.+)$",
        stream_uploaded_media,
        name="uploaded_media_range",
    ),

    # Rutas de aplicaciones
    path("", include("inicio_sesion.urls")),
    path("admin/", admin.site.urls),
    path("gestion/", include("gestion.urls")),
    path("", include("reproductor.urls")),
    path("", include("muro.urls")),
    path("feed/", include("feed.urls")),

    # Favicon
    path("favicon.ico", favicon_root, name="favicon"),
]

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)

# inicio_sesion/apps.py
from django.apps import AppConfig


class InicioSesionConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "inicio_sesion"

    def ready(self):
        # Registra receptores de señales (post_migrate + protecciones a superadmin)
        from . import signals  # noqa: F401

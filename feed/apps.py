"""Configuración de la aplicación «feed»."""

from django.apps import AppConfig


class FeedConfig(AppConfig):
    """Metadatos de la app Feed para Django."""
    default_auto_field = "django.db.models.BigAutoField"
    name = "feed"

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db.models.signals import post_migrate, pre_delete, pre_save
from django.dispatch import receiver

from .models import Users


@receiver(post_migrate)
def ensure_seed_after_migrate(app_config, **kwargs):
    """
    Tras migrar la app `inicio_sesion`, crea/actualiza usuarios base
    ejecutando el management command `ensure_initial_users` (idempotente).
    """
    if getattr(settings, "AUTO_ENSURE_INITIAL_USERS", True):
        if getattr(app_config, "name", "") == "inicio_sesion":
            call_command("ensure_initial_users")


@receiver(pre_delete, sender=Users)
def _protect_delete_superadmin(sender, instance, **kwargs):
    """Impide eliminar la cuenta marcada como superadmin."""
    if instance.is_superadmin:
        raise ValidationError("No se puede eliminar la cuenta superadmin.")


@receiver(pre_save, sender=Users)
def _protect_last_superadmin(sender, instance, **kwargs):
    """
    Garantiza la existencia de al menos un superadmin.
    Si la instancia es superadmin, fija rol y actividad.
    Bloquea la despromoción del último superadmin.
    """
    if instance.is_superadmin:
        instance.type = "Administrador"
        instance.is_active = True
        return

    if instance.pk:
        try:
            before = Users.objects.get(pk=instance.pk)
        except Users.DoesNotExist:
            return

        if before.is_superadmin and not instance.is_superadmin:
            exists_other = (
                Users.objects.exclude(pk=instance.pk)
                .filter(is_superadmin=True)
                .exists()
            )
            if not exists_other:
                raise ValidationError("Debe existir al menos un superadmin.")

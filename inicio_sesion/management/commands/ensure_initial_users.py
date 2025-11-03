# inicio_sesion/management/commands/ensure_initial_users.py
from django.core.management.base import BaseCommand

from inicio_sesion.models import Users


class Command(BaseCommand):
    help = "Crea/actualiza usuarios base: admin (superadmin), artist, viewer."

    def handle(self, *args, **options):
        seed = [
            {
                "user": "admin",
                "password": "admin123",
                "type": "Administrador",
                "is_superadmin": True,
                "is_active": True,
            },
            {
                "user": "artist",
                "password": "artist123",
                "type": "Artista",
                "is_superadmin": False,
                "is_active": True,
            },
            {
                "user": "viewer",
                "password": "viewer123",
                "type": "Usuario",
                "is_superadmin": False,
                "is_active": True,
            },
        ]

        for u in seed:
            obj, created = Users.objects.update_or_create(
                user=u["user"],
                defaults={
                    "password": u["password"],
                    "type": u["type"],
                    "is_superadmin": u["is_superadmin"],
                    "is_active": u["is_active"],
                },
            )
            self.stdout.write(
                f"{'CREADO' if created else 'ACTUALIZADO'}: {obj.user} "
                f"(rol={obj.type}, superadmin={obj.is_superadmin})"
            )

        self.stdout.write(self.style.SUCCESS("Usuarios base listos."))

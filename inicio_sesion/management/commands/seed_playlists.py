# inicio_sesion/management/commands/seed_playlists.py
from django.core.management.base import BaseCommand
from django.db import connection, transaction
from inicio_sesion.models import Users, Song, PlayList, PlayListSong

class Command(BaseCommand):
    help = "Crea playlists demo por artista con sus canciones."

    def add_arguments(self, parser):
        parser.add_argument("--max", type=int, default=10)
        parser.add_argument("--prefix", default="Demo — ")
        parser.add_argument("--private", action="store_true")
        parser.add_argument("--wipe", action="store_true", help="Borra todas las playlists y vínculos antes de crear")

    def handle(self, *args, **opts):
        tables = set(connection.introspection.table_names())
        if "inicio_sesion_playlist" not in tables or "PlayListSong" not in tables:
            self.stderr.write("Tablas de playlists no existen; saltando.")
            return

        if opts["wipe"]:
            self.stdout.write("Borrando playlists y vínculos…")
            with transaction.atomic():
                PlayListSong.objects.all().delete()
                PlayList.objects.all().delete()

        made_pl = links = 0
        for u in Users.objects.filter(type="Artista", is_active=True):
            pl, _ = PlayList.objects.get_or_create(
                idUser=u.id,
                name=f"{opts['prefix']}{u.user}",
                defaults={
                    "portada": "",
                    "isprivate": bool(opts["private"]),
                },
            )
            pos = 0
            for s in Song.objects.filter(owner_user=u.user).order_by("-created_at"):
                obj, created = PlayListSong.objects.get_or_create(
                    playlist_id=pl.id, song_id=s.id, defaults={"position": pos + 1}
                )
                if created:
                    pos += 1
                if pos >= opts["max"]:
                    break
            made_pl += 1
            links += pos

        self.stdout.write(self.style.SUCCESS(f"Playlists creadas: {made_pl}, vínculos añadidos: {links}"))

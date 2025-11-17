# inicio_sesion/management/commands/seed_demo.py
import json, hashlib, mimetypes
from pathlib import Path
from django.core.management.base import BaseCommand
from django.core.files import File
from django.core.files.storage import default_storage
from django.utils.text import slugify

from inicio_sesion.models import Users, ArtistProfile, Song

SUPPORTED_AUDIO = {".mp3", ".m4a", ".wav", ".ogg", ".flac"}
SUPPORTED_IMG   = {".jpg", ".jpeg", ".png", ".webp"}

def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def pick_one(folder: Path, exts) -> Path | None:
    if not folder.exists(): return None
    for p in sorted(folder.iterdir()):
        if p.suffix.lower() in exts and p.is_file():
            return p
    return None

class Command(BaseCommand):
    help = "Siembra usuarios/artistas/canciones desde seeds/artists."

    def add_arguments(self, parser):
        parser.add_argument("--root", default="seeds/artists", help="Raíz de artistas")
        parser.add_argument("--default-pass", default="seed123", help="Password por defecto")
        parser.add_argument("--genre", default="demo", help="Género por defecto si no hay meta.json")
        parser.add_argument("--replace-avatars", action="store_true", help="Reemplaza avatar existente")
        parser.add_argument("--replace-covers",  action="store_true", help="Reemplaza covers de canciones")

    def handle(self, *args, **opts):
        root = Path(opts["root"]).resolve()
        if not root.exists():
            self.stderr.write(f"No existe: {root}")
            return

        total_users = total_songs = 0

        for artist_dir in sorted([d for d in root.iterdir() if d.is_dir()]):
            a_slug = artist_dir.name
            meta = {}
            meta_path = artist_dir / "meta.json"
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                except Exception as e:
                    self.stderr.write(f"[{a_slug}] meta.json inválido: {e}")
            display_name = meta.get("artist_display_name") or a_slug.replace("_", " ").title()
            genre_default = meta.get("genre") or opts["genre"]

            # Usuario / perfil
            user, created = Users.objects.get_or_create(
                user=a_slug,
                defaults={
                    "password": opts["default_pass"],
                    "type": "Artista",
                    "is_superadmin": False,
                },
            )
            if created:
                total_users += 1

            ArtistProfile.objects.get_or_create(user=user, defaults={"description": meta.get("bio", "")})

            # Avatar
            avatar_file = pick_one(artist_dir / "avatar", SUPPORTED_IMG)
            if avatar_file and (opts["replace-avatars"] or not user.avatar.name):
                with avatar_file.open("rb") as fh:
                    name = f"uploaded_avatars/{a_slug}{avatar_file.suffix.lower()}"
                    user.avatar.save(name, File(fh), save=True)

            # Cover por defecto del artista (si no hay cover por-canción)
            default_cover = pick_one(artist_dir / "covers", SUPPORTED_IMG)

            # Canciones
            audio_dir = artist_dir / "audio"
            if not audio_dir.exists():
                self.stdout.write(f"[{a_slug}] sin carpeta audio/, saltando")
                continue

            for audio in sorted(audio_dir.iterdir()):
                if not (audio.is_file() and audio.suffix.lower() in SUPPORTED_AUDIO):
                    continue

                # título por nombre de archivo o por meta.json.songs
                title = audio.stem.replace("_", " ").title()
                if meta.get("songs"):
                    # si hay coincidencia exacta por nombre de archivo en meta.json, usa title/genre allí
                    for s in meta["songs"]:
                        if s.get("file") == f"audio/{audio.name}" or s.get("filename") == audio.name:
                            title = s.get("title") or title
                            genre_default = s.get("genre") or genre_default
                            break

                ahash = sha256_file(audio)
                exists = Song.objects.filter(owner_user=user.user, audio_sha256=ahash).first()
                if exists:
                    # ya cargado con el mismo hash → idempotente
                    continue

                song = Song(
                    title=title,
                    artist_display_name=display_name,
                    genre=genre_default,
                    owner_user=user.user,
                    audio_sha256=ahash,
                    visibility="public",
                )

                # Audio → uploaded_songs/
                with audio.open("rb") as fh:
                    dest_name = f"uploaded_songs/{a_slug}_{slugify(title)}{audio.suffix.lower()}"
                    song.audio_file.save(dest_name, File(fh), save=False)

                # Cover de canción: 1) cover con mismo nombre en covers/, 2) cover por defecto
                cover_path = (artist_dir / "covers" / f"{audio.stem}").with_suffix(".jpg")
                if not cover_path.exists():
                    cover_path = (artist_dir / "covers" / f"{audio.stem}").with_suffix(".png")
                if cover_path.exists() or default_cover:
                    src = cover_path if cover_path.exists() else default_cover
                    if src and (opts["replace-covers"] or not song.cover_image.name):
                        with src.open("rb") as fh:
                            cext = src.suffix.lower()
                            cname = f"uploaded_covers/{a_slug}_{slugify(title)}{cext}"
                            song.cover_image.save(cname, File(fh), save=False)

                song.save()
                total_songs += 1

        self.stdout.write(self.style.SUCCESS(f"Hecho. Usuarios nuevos: {total_users}, Canciones nuevas: {total_songs}"))

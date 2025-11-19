# inicio_sesion/management/commands/seed_demo.py
import json
import hashlib
from pathlib import Path

from django.core.management.base import BaseCommand
from django.core.files import File
from django.utils.text import slugify

from inicio_sesion.models import Users, ArtistProfile, Song

SUPPORTED_AUDIO = {".mp3", ".m4a", ".wav", ".ogg", ".flac"}
SUPPORTED_IMG = {".jpg", ".jpeg", ".png", ".webp"}


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def pick_one(folder: Path, exts) -> Path | None:
    if not folder.exists():
        return None
    for p in sorted(folder.iterdir()):
        if p.is_file() and p.suffix.lower() in exts:
            return p
    return None


def pick_cover_for_stem(covers_dir: Path, stem: str) -> Path | None:
    if not covers_dir.exists():
        return None
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        cand = (covers_dir / stem).with_suffix(ext)
        if cand.exists() and cand.is_file():
            return cand
    return None


class Command(BaseCommand):
    help = "Siembra usuarios, perfiles de artista y canciones desde seeds/artists."

    def add_arguments(self, parser):
        parser.add_argument("--root", default="seeds/artists", help="Raíz de artistas")
        parser.add_argument("--default-pass", dest="default_pass", default="seed123", help="Password por defecto")
        parser.add_argument("--genre", default="demo", help="Género por defecto si no hay meta.json")
        parser.add_argument("--replace-avatars", dest="replace_avatars", action="store_true", help="Reemplaza avatar existente")
        parser.add_argument("--replace-covers", dest="replace_covers", action="store_true", help="Reemplaza covers de canciones")
        parser.add_argument("--replace-audio", dest="replace_audio", action="store_true", help="Reemplaza audio si ya existe canción con mismo título")

    def handle(self, *args, **opts):
        root = Path(opts["root"]).resolve()
        if not root.exists():
            self.stderr.write(f"No existe: {root}")
            return

        default_pass = opts["default_pass"]
        default_genre_global = opts["genre"]
        replace_avatars = opts.get("replace_avatars", False)
        replace_covers = opts.get("replace_covers", False)
        replace_audio = opts.get("replace_audio", False)

        total_users = 0
        total_songs = 0

        artist_dirs = [d for d in root.iterdir() if d.is_dir()]
        for artist_dir in sorted(artist_dirs):
            a_slug = artist_dir.name

            # meta.json opcional
            meta = {}
            meta_path = artist_dir / "meta.json"
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                except Exception as e:
                    self.stderr.write(f"[{a_slug}] meta.json inválido: {e}")

            display_name = meta.get("artist_display_name") or a_slug.replace("_", " ").title()
            genre_default = meta.get("genre") or default_genre_global

            # Usuario / perfil
            user, created = Users.objects.get_or_create(
                user=a_slug,
                defaults={
                    "password": default_pass,
                    "type": "Artista",
                    "is_superadmin": False,
                    "is_active": True,
                },
            )
            if created:
                total_users += 1

            ArtistProfile.objects.get_or_create(
                user=user,
                defaults={"description": meta.get("bio", "")},
            )

            # Avatar
            avatar_file = pick_one(artist_dir / "avatar", SUPPORTED_IMG)
            if avatar_file and (replace_avatars or not user.avatar.name):
                with avatar_file.open("rb") as fh:
                    name = f"uploaded_avatars/{a_slug}{avatar_file.suffix.lower()}"
                    user.avatar.save(name, File(fh), save=True)

            # Cover por defecto del artista
            default_cover = pick_one(artist_dir / "covers", SUPPORTED_IMG)

            # Canciones
            audio_dir = artist_dir / "audio"
            if not audio_dir.exists():
                self.stdout.write(f"[{a_slug}] sin carpeta audio/, se omite")
                continue

            for audio in sorted(audio_dir.iterdir()):
                if not (audio.is_file() and audio.suffix.lower() in SUPPORTED_AUDIO):
                    continue

                # Título y género por canción
                title = audio.stem.replace("_", " ").title()
                song_genre = genre_default
                if meta.get("songs"):
                    for s in meta["songs"]:
                        if s.get("file") == f"audio/{audio.name}" or s.get("filename") == audio.name:
                            title = s.get("title") or title
                            song_genre = s.get("genre") or song_genre
                            break

                ahash = sha256_file(audio)

                # Si existe misma canción por título y dueño, actualiza si replace_audio
                existing_by_title = Song.objects.filter(owner_user=user.user, title=title).first()
                if existing_by_title:
                    changed = False
                    if replace_audio:
                        with audio.open("rb") as fh:
                            dest_name = f"uploaded_songs/{a_slug}_{slugify(title)}{audio.suffix.lower()}"
                            existing_by_title.audio_file.save(dest_name, File(fh), save=False)
                        existing_by_title.audio_sha256 = ahash
                        changed = True

                    # Cover de canción para actualización
                    cover_src = pick_cover_for_stem(artist_dir / "covers", audio.stem) or default_cover
                    if cover_src and (replace_covers or not existing_by_title.cover_image.name):
                        with cover_src.open("rb") as fh:
                            cext = cover_src.suffix.lower()
                            cname = f"uploaded_covers/{a_slug}_{slugify(title)}{cext}"
                            existing_by_title.cover_image.save(cname, File(fh), save=False)
                        changed = True

                    if changed:
                        existing_by_title.genre = song_genre
                        existing_by_title.artist_display_name = display_name
                        existing_by_title.visibility = "public"
                        existing_by_title.save()
                    continue

                # Evita duplicados por hash (mismo archivo ya cargado para ese dueño)
                exists_by_hash = Song.objects.filter(owner_user=user.user, audio_sha256=ahash).first()
                if exists_by_hash and not replace_audio:
                    continue

                # Crear nueva canción
                song = Song(
                    title=title,
                    artist_display_name=display_name,
                    genre=song_genre,
                    owner_user=user.user,
                    audio_sha256=ahash,
                    visibility="public",
                )

                with audio.open("rb") as fh:
                    dest_name = f"uploaded_songs/{a_slug}_{slugify(title)}{audio.suffix.lower()}"
                    song.audio_file.save(dest_name, File(fh), save=False)

                cover_src = pick_cover_for_stem(artist_dir / "covers", audio.stem) or default_cover
                if cover_src:
                    with cover_src.open("rb") as fh:
                        cext = cover_src.suffix.lower()
                        cname = f"uploaded_covers/{a_slug}_{slugify(title)}{cext}"
                        song.cover_image.save(cname, File(fh), save=False)

                song.save()
                total_songs += 1

        self.stdout.write(self.style.SUCCESS(f"Hecho. Usuarios nuevos: {total_users}, Canciones nuevas: {total_songs}"))

# inicio_sesion/management/commands/seed_demo.py
import json
import re
import unicodedata
import hashlib
from pathlib import Path

from django.core.management.base import BaseCommand
from django.core.files import File
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


def strip_accents(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    return "".join(ch for ch in s if not unicodedata.combining(ch))


_SEP_RE = re.compile(r"[\s_\-–—~·\.]+")
_TRASH_RE = re.compile(r"[\"'´`‘’“”\(\)\[\]\{\}:;,!?\|/\\]+")

def norm_key(s: str) -> str:
    """
    Clave de comparación para nombres de archivo/títulos:
    - toma el nombre (sin ruta) y el stem (sin extensión)
    - quita acentos, comillas y puntuación “ruidosa”
    - une separadores (espacios/guiones/underscores) y pasa a minúsculas
    - también recorta patrones comunes “ - artista”
    """
    if not s:
        return ""
    name = Path(s.replace("\\", "/")).name
    stem = Path(name).stem

    stem = stem.split(" - ")[0]

    stem = strip_accents(stem)
    stem = _TRASH_RE.sub("", stem)

    stem = _SEP_RE.sub(" ", stem).strip().lower()
    return stem


def pick_one(folder: Path, exts) -> Path | None:
    if not folder.exists():
        return None
    for p in sorted(folder.iterdir()):
        if p.is_file() and p.suffix.lower() in exts:
            return p
    return None


def pick_cover_for_stem(covers_dir: Path, audio_stem: str) -> Path | None:
    """
    Busca cover para un stem de audio probando:
      1) coincidencia exacta por nombre con extensiones conocidas
      2) escaneo completo con clave normalizada (tolerante a acentos/guiones)
    """
    if not covers_dir.exists():
        return None

    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        cand = (covers_dir / audio_stem).with_suffix(ext)
        if cand.exists() and cand.is_file():
            return cand

    key = norm_key(audio_stem)
    for p in sorted(covers_dir.iterdir()):
        if p.is_file() and p.suffix.lower() in SUPPORTED_IMG:
            if norm_key(p.stem) == key:
                return p
    return None


class Command(BaseCommand):
    help = "Siembra usuarios, perfiles de artista y canciones desde seeds/artists."

    def add_arguments(self, parser):
        parser.add_argument("--root", default="seeds/artists", help="Raíz de artistas")
        parser.add_argument("--default-pass", dest="default_pass", default="seed123", help="Password por defecto")
        parser.add_argument("--genre", default="demo", help="Género por defecto si no hay meta.json")
        parser.add_argument("--replace-avatars", dest="replace_avatars", action="store_true", help="Reemplaza avatar existente")
        parser.add_argument("--replace-covers",  dest="replace_covers",  action="store_true", help="Reemplaza covers de canciones")
        parser.add_argument("--replace-audio",   dest="replace_audio",   action="store_true", help="Reemplaza audio si ya existe canción con mismo título")

    def handle(self, *args, **opts):
        root = Path(opts["root"]).resolve()
        if not root.exists():
            self.stderr.write(f"No existe: {root}")
            return

        default_pass = opts["default_pass"]
        default_genre_global = opts["genre"]
        replace_avatars = bool(opts.get("replace_avatars", False))
        replace_covers  = bool(opts.get("replace_covers", False))
        replace_audio   = bool(opts.get("replace_audio", False))

        total_users = 0
        total_songs = 0

        artist_dirs = [d for d in root.iterdir() if d.is_dir()]
        for artist_dir in sorted(artist_dirs):
            a_slug = artist_dir.name  
            meta = {}
            meta_path = artist_dir / "meta.json"
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                except Exception as e:
                    self.stderr.write(f"[{a_slug}] meta.json inválido: {e}")

            display_name = meta.get("artist_display_name") or a_slug.replace("_", " ").title()
            genre_default = meta.get("genre") or default_genre_global

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

            avatar_file = pick_one(artist_dir / "avatar", SUPPORTED_IMG)
            if avatar_file and (replace_avatars or not user.avatar.name):
                with avatar_file.open("rb") as fh:
                    aname = f"uploaded_avatars/{slugify(a_slug)}{avatar_file.suffix.lower()}"
                    user.avatar.save(aname, File(fh), save=True)

            default_cover = pick_one(artist_dir / "covers", SUPPORTED_IMG)

            audio_dir = artist_dir / "audio"
            if not audio_dir.exists():
                self.stdout.write(f"[{a_slug}] sin carpeta audio/, se omite")
                continue

            songs_meta = meta.get("songs") or []
            meta_by_key = {}
            for s in songs_meta:
                fn = s.get("file") or s.get("filename") or ""
                meta_by_key[norm_key(fn)] = s

            for audio in sorted(audio_dir.iterdir()):
                if not (audio.is_file() and audio.suffix.lower() in SUPPORTED_AUDIO):
                    continue

                title_guess = audio.stem.replace("_", " ")
                song_genre  = genre_default

                m = meta_by_key.get(norm_key(audio.name))
                if m:
                    title = m.get("title") or title_guess
                    song_genre = m.get("genre") or song_genre
                else:
                    title = title_guess

                title = title.strip()
                if title:
                    title = title[0].upper() + title[1:]

                ahash = sha256_file(audio)

                exists_by_hash = Song.objects.filter(owner_user=user.user, audio_sha256=ahash).first()
                if exists_by_hash and not replace_audio:
                    continue

                existing_by_title = Song.objects.filter(owner_user=user.user, title=title).first()

                base_slug = f"{slugify(a_slug)}_{slugify(title)}_{ahash[:8]}"
                audio_dest = f"uploaded_songs/{base_slug}{audio.suffix.lower()}"

                if existing_by_title:
                    changed = False
                    if replace_audio:
                        with audio.open("rb") as fh:
                            existing_by_title.audio_file.save(audio_dest, File(fh), save=False)
                        existing_by_title.audio_sha256 = ahash
                        changed = True

                    cover_src = pick_cover_for_stem(artist_dir / "covers", audio.stem) or default_cover
                    if cover_src and (replace_covers or not existing_by_title.cover_image.name):
                        with cover_src.open("rb") as fh:
                            cext = cover_src.suffix.lower()
                            cover_dest = f"uploaded_covers/{base_slug}{cext}"
                            existing_by_title.cover_image.save(cover_dest, File(fh), save=False)
                        changed = True

                    if changed:
                        existing_by_title.genre = song_genre
                        existing_by_title.artist_display_name = display_name
                        existing_by_title.visibility = "public"
                        existing_by_title.save()
                    continue

                song = Song(
                    title=title,
                    artist_display_name=display_name,
                    genre=song_genre,
                    owner_user=user.user,
                    audio_sha256=ahash,
                    visibility="public",
                )

                with audio.open("rb") as fh:
                    song.audio_file.save(audio_dest, File(fh), save=False)

                cover_src = pick_cover_for_stem(artist_dir / "covers", audio.stem) or default_cover
                if cover_src:
                    with cover_src.open("rb") as fh:
                        cext = cover_src.suffix.lower()
                        cover_dest = f"uploaded_covers/{base_slug}{cext}"
                        song.cover_image.save(cover_dest, File(fh), save=False)

                song.save()
                total_songs += 1

        self.stdout.write(self.style.SUCCESS(
            f"Hecho. Usuarios nuevos: {total_users}, Canciones nuevas: {total_songs}"
        ))

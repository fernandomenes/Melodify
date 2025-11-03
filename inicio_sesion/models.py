from django.core.validators import FileExtensionValidator, MaxLengthValidator
from django.db import models


class Users(models.Model):
    """Modelo de usuario de la plataforma (Administrador, Artista o Usuario)."""

    user = models.CharField(max_length=100, unique=True)
    password = models.CharField(max_length=100)
    type = models.CharField(max_length=50)

    avatar = models.ImageField(upload_to="uploaded_avatars/", null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # Cuenta protegida a nivel de gestión (no eliminable/renombrable/desactivable).
    is_superadmin = models.BooleanField(default=False)

    def __str__(self) -> str:
        return self.user

    class Meta:
        db_table = "Users"


class ArtistProfile(models.Model):
    """Perfil complementario para artistas (descripción hasta 200 caracteres)."""

    user = models.OneToOneField(
        Users, on_delete=models.CASCADE, related_name="artist_profile"
    )
    description = models.CharField(
        max_length=200, blank=True, validators=[MaxLengthValidator(200)]
    )

    def __str__(self) -> str:
        return f"Perfil {self.user.user}"

    class Meta:
        db_table = "ArtistProfiles"


class Song(models.Model):
    """
    Canción disponible para reproducción y gestión.

    Campos clave:
      - audio_file: archivo de audio validado por extensión.
      - title / artist_display_name: metadatos visibles.
      - owner_user: usuario Artista que sube la canción.
      - audio_sha256: hash del contenido para deduplicación lógica.
      - visibility: estado de publicación ('public' | 'removed').
    """

    title = models.CharField(max_length=200)
    artist_display_name = models.CharField(max_length=200)
    genre = models.CharField(max_length=40, blank=True, default="", db_index=True)
    owner_user = models.CharField(max_length=100, db_index=True)

    audio_file = models.FileField(
        upload_to="uploaded_songs/",
        validators=[
            FileExtensionValidator(
                allowed_extensions=["mp3", "wav", "ogg", "m4a", "flac"]
            )
        ],
    )
    cover_image = models.ImageField(upload_to="uploaded_covers/", null=True, blank=True)

    audio_sha256 = models.CharField(
        max_length=64, blank=True, default="", db_index=True
    )

    created_at = models.DateTimeField(auto_now_add=True)
    visibility = models.CharField(
        max_length=16,
        choices=(("public", "public"), ("removed", "removed")),
        default="public",
        db_index=True,
    )

    class Meta:
        db_table = "Songs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["owner_user", "audio_sha256", "visibility"],
                name="idx_song_owner_hash_vis",
            )
        ]

    def __str__(self) -> str:
        return f"{self.title} — {self.artist_display_name}"

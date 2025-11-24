from django.core.validators import FileExtensionValidator, MaxLengthValidator
from django.db import models
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType


# ======================================================================
# Usuarios y Perfiles
# ======================================================================

class Users(models.Model):
    """
    Modelo de usuario de la plataforma.

    El campo `type` se usa para rol:
    - "Administrador"
    - "Artista"
    - "Usuario"
    """
    user = models.CharField(max_length=100, unique=True)
    password = models.CharField(max_length=100)
    type = models.CharField(max_length=50)

    avatar = models.ImageField(upload_to="uploaded_avatars/", null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # Cuenta protegida en la interfaz de gestión (no se elimina/renombra/desactiva).
    is_superadmin = models.BooleanField(default=False)

    class Meta:
        db_table = "Users"

    def __str__(self) -> str:
        return self.user


class ArtistProfile(models.Model):
    """
    Perfil adicional para usuarios con rol de artista.

    Permite almacenar una breve descripción (hasta 200 caracteres).
    """
    user = models.OneToOneField(
        Users,
        on_delete=models.CASCADE,
        related_name="artist_profile",
    )
    description = models.CharField(
        max_length=200,
        blank=True,
        validators=[MaxLengthValidator(200)],
    )

    class Meta:
        db_table = "ArtistProfiles"

    def __str__(self) -> str:
        return f"Perfil {self.user.user}"


# ======================================================================
# Canciones
# ======================================================================

class Song(models.Model):
    """
    Canción disponible para reproducción y gestión.
    """
    title = models.CharField(max_length=200)
    artist_display_name = models.CharField(max_length=200)
    genre = models.CharField(
        max_length=40,
        blank=True,
        default="",
        db_index=True,
    )
    # Usuario propietario (username en Users.user)
    owner_user = models.CharField(
        max_length=100,
        db_index=True,
    )

    audio_file = models.FileField(
        upload_to="uploaded_songs/",
        validators=[
            FileExtensionValidator(
                allowed_extensions=["mp3", "wav", "ogg", "m4a", "flac"]
            )
        ],
    )
    cover_image = models.ImageField(
        upload_to="uploaded_covers/",
        null=True,
        blank=True,
    )

    # Hash del audio (para evitar duplicados por usuario)
    audio_sha256 = models.CharField(
        max_length=64,
        blank=True,
        default="",
        db_index=True,
    )

    created_at = models.DateTimeField(auto_now_add=True)

    visibility = models.CharField(
        max_length=16,
        choices=(
            ("public", "public"),
            ("removed", "removed"),
        ),
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
            ),
        ]

    def __str__(self) -> str:
        return f"{self.title} — {self.artist_display_name}"


# ======================================================================
# Playlists (tablas externas / legadas, no gestionadas por migraciones)
# ======================================================================

class PlayList(models.Model):
    id         = models.AutoField(primary_key=True)
    idUser     = models.IntegerField()
    name       = models.CharField(max_length=200)
    portada    = models.CharField(max_length=200, blank=True, default="")
    isprivate  = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "inicio_sesion_playlist"
        managed  = False

    def __str__(self): return f"Playlist {self.name} (user_id={self.idUser})"


class PlayListSong(models.Model):
    playlist_id = models.IntegerField()
    song_id     = models.IntegerField()
    position    = models.IntegerField()

    class Meta:
        db_table = "PlayListSong"
        managed  = False
        unique_together = (("playlist_id", "song_id"),)

    def __str__(self):
        return f"PlaylistSong pl={self.playlist_id} song={self.song_id} pos={self.position}"


# ======================================================================
# Likes genéricos (Song / PlayList / otros con GFK)
# ======================================================================

class LikeMedia(models.Model):
    """
    Registro de "likes" genérico para distintos tipos de objeto.

    - user: FK a Users.
    - content_type + object_id -> GenericForeignKey al objeto likeado
      (por ejemplo Song o PlayList).
    """
    user = models.ForeignKey(
        Users,
        on_delete=models.CASCADE,
        related_name="likes",
    )
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField(db_index=True)
    content_object = GenericForeignKey("content_type", "object_id")

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "LikeMedia"
        unique_together = (("user", "content_type", "object_id"),)
        indexes = [
            models.Index(
                fields=["content_type", "object_id"],
                name="idx_likemedia_ct_obj",
            ),
        ]

    def __str__(self) -> str:
        return f"Like by {self.user.user} -> {self.content_type}#{self.object_id}"

class PlaylistCollaborator(models.Model):
    """
    Colaboradores de playlists. Guardamos playlist_id como entero
    porque PlayList usa managed=False / idUser int.
    collaborator_user almacena el campo Users.user (username).
    """
    playlist_id = models.IntegerField(db_index=True)
    collaborator_user = models.CharField(max_length=100, db_index=True)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "PlaylistCollaborators"
        unique_together = (("playlist_id", "collaborator_user"),)
        ordering = ["-added_at"]






class Followers(models.Model):
    seguidor = models.ForeignKey('Users', related_name='following', on_delete=models.CASCADE)
    seguido  = models.ForeignKey('Users', related_name='followers', on_delete=models.CASCADE)
    followed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'Followers'
        unique_together = ('seguidor', 'seguido')
        managed = False   # ← ESTA LÍNEA ES LA CLAVE




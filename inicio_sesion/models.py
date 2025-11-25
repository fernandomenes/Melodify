"""
Modelos principales de Melodify:

- Users / ArtistProfile: usuarios y perfil adicional de artista.
- Song: canciones (audio + portada + visibilidad).
- PlayList / PlayListSong: tablas legadas de playlists (no gestionadas por migraciones).
- LikeMedia: likes genéricos sobre distintos tipos de objeto (Song, PlayList, ...).
- FollowArtist: relación de seguimiento entre usuarios y artistas.
- PlaylistCollaborator: colaboradores de playlists (editor / viewer).
- Followers: tabla legada de seguidores (no gestionada por migraciones).
"""

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

    El campo `type` se usa como rol lógico:

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

    # Cuenta protegida en la interfaz de gestión
    # (no se elimina/renombra/desactiva desde el panel).
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
    Canción disponible para reproducción y gestión dentro de la plataforma.

    Campos destacados:
    - owner_user: username del dueño (Users.user).
    - audio_file / cover_image: archivos subidos al storage configurado.
    - audio_sha256: hash del audio para evitar duplicados por usuario.
    - visibility: "public" o "removed" (no se borra físicamente).
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
    """
    Tabla legada de playlists (managed=False).

    Se asume:
    - idUser: id entero del usuario dueño (tabla Users).
    - name: nombre visible de la playlist.
    - isprivate: True → sólo el dueño y colaboradores la ven/usan.
    """
    id = models.AutoField(primary_key=True)
    idUser = models.IntegerField()
    name = models.CharField(max_length=200)
    portada = models.CharField(max_length=200, blank=True, default="")
    isprivate = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "inicio_sesion_playlist"
        managed = False

    def __str__(self):
        return f"Playlist {self.name} (user_id={self.idUser})"


class PlayListSong(models.Model):
    """
    Relación many-to-many (tabla intermedia) entre PlayList y Song.

    - playlist_id: id entero de PlayList.
    - song_id: id entero de Song.
    - position: orden dentro de la playlist.
    """
    playlist_id = models.IntegerField()
    song_id = models.IntegerField()
    position = models.IntegerField()

    class Meta:
        db_table = "PlayListSong"
        managed = False
        unique_together = (("playlist_id", "song_id"),)

    def __str__(self):
        return (
            f"PlaylistSong pl={self.playlist_id} "
            f"song={self.song_id} pos={self.position}"
        )


# ======================================================================
# Likes genéricos (Song / PlayList / otros con GFK)
# ======================================================================


class LikeMedia(models.Model):
    """
    Registro de "likes" genérico para distintos tipos de objeto.

    - user: FK a Users.
    - content_type + object_id -> GenericForeignKey al objeto likeado
      (por ejemplo Song, PlayList u otros modelos que se deseen).
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


class FollowArtist(models.Model):
    """
    Relación de seguimiento entre usuarios y artistas.

    - follower: usuario que sigue.
    - artist:   usuario con rol de artista que es seguido.
    """
    follower = models.ForeignKey(
        Users,
        on_delete=models.CASCADE,
        related_name="following_artists",
    )
    artist = models.ForeignKey(
        Users,
        on_delete=models.CASCADE,
        related_name="artist_followers",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "FollowArtists"
        unique_together = (("follower", "artist"),)
        indexes = [
            models.Index(fields=["artist"], name="idx_follow_artist_artist"),
            models.Index(fields=["follower"], name="idx_follow_artist_follower"),
        ]

    def __str__(self) -> str:
        return f"{self.follower.user} sigue a {self.artist.user}"


class PlaylistCollaborator(models.Model):
    """
    Colaboradores de playlists.

    - playlist_id: id entero de la playlist (PlayList usa managed=False).
    - user: FK a Users del colaborador.
    - role:
        * 'editor': puede agregar/quitar canciones, renombrar, etc.
        * 'viewer': sólo ve la playlist en su lista (sin edición).
    """
    playlist_id = models.IntegerField(db_index=True)
    user = models.ForeignKey(
        Users,
        on_delete=models.CASCADE,
        related_name="playlist_collaborations",
        null=True,  
        blank=True,  
    )
    role = models.CharField(
        max_length=16,
        choices=(("editor", "editor"), ("viewer", "viewer")),
        default="editor",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "PlaylistCollaborators"
        unique_together = (("playlist_id", "user"),)
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["playlist_id"], name="idx_plcollab_playlist"),
        ]

    def __str__(self) -> str:
        return f"Collab {self.user.user} -> playlist {self.playlist_id} ({self.role})"


class Followers(models.Model):
    """
    Tabla legada de seguidores (no gestionada por migraciones).

    Se mantiene para compatibilidad con la BD existente.
    """
    seguidor = models.ForeignKey(
        "Users",
        related_name="following",
        on_delete=models.CASCADE,
    )
    seguido = models.ForeignKey(
        "Users",
        related_name="followers",
        on_delete=models.CASCADE,
    )
    followed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "Followers"
        unique_together = ("seguidor", "seguido")
        managed = False   

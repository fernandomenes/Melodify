# inicio_sesion/tests/test_eliminar.py
from django.urls import reverse

from inicio_sesion.models import Song

from .base import BasePruebas


class PruebasEliminarCancion(BasePruebas):
    """Conjunto de pruebas para la vista 'eliminar_cancion'."""

    def test_dueno_puede_eliminar(self):
        """El dueño de la canción puede hacer eliminación lógica."""
        song = Song.objects.create(
            title="Mía",
            artist_display_name="Art",
            owner_user="artist",
            audio_file="/uploaded_media/a.mp3",
            cover_image=None,
            visibility="public",
        )
        self.iniciar_sesion("artist", "Artista")
        resp = self.client.post(reverse("eliminar_cancion", args=[song.id]))
        self.assertEqual(resp.status_code, 302)
        song.refresh_from_db()
        self.assertEqual(song.visibility, "removed")

    def test_admin_puede_eliminar_cualquier_cancion(self):
        """El admin puede eliminar (soft delete) cualquier canción."""
        song = Song.objects.create(
            title="Ajena",
            artist_display_name="Art",
            owner_user="artist",
            audio_file="/uploaded_media/b.mp3",
            cover_image=None,
            visibility="public",
        )
        self.iniciar_sesion("admin", "Administrador")
        resp = self.client.post(reverse("eliminar_cancion", args=[song.id]))
        self.assertEqual(resp.status_code, 302)
        song.refresh_from_db()
        self.assertEqual(song.visibility, "removed")

    def test_tercero_no_puede_eliminar(self):
        """Un usuario que no es dueño ni admin recibe 403 y no cambia el estado."""
        song = Song.objects.create(
            title="De otro",
            artist_display_name="Art",
            owner_user="artist",
            audio_file="/uploaded_media/c.mp3",
            cover_image=None,
            visibility="public",
        )
        self.iniciar_sesion("viewer", "Usuario")
        resp = self.client.post(reverse("eliminar_cancion", args=[song.id]))
        self.assertEqual(resp.status_code, 403)
        song.refresh_from_db()
        self.assertEqual(song.visibility, "public")

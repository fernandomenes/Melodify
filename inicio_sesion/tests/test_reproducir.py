# inicio_sesion/tests/test_reproducir.py
import json

from django.urls import reverse

from inicio_sesion.models import Song

from .base import BasePruebas


class PruebasReproductor(BasePruebas):
    """
    Pruebas de backend para el reproductor:
    - El home del ARTISTA inyecta la playlist "Mi música" con sus canciones públicas.
    - Otros roles NO reciben playlists.
    - El HTML incluye el <script id="playlists-data-json"> con el JSON esperado.
    """

    def setUp(self):
        super().setUp()
        # Canciones del artista principal (visibles)
        Song.objects.create(
            title="Canción A",
            artist_display_name="Artista X",
            owner_user="artist",
            audio_file="/uploaded_media/a.mp3",
            visibility="public",
        )
        Song.objects.create(
            title="Canción B",
            artist_display_name="Artista X",
            owner_user="artist",
            audio_file="/uploaded_media/b.mp3",
            visibility="public",
        )
        # Canción de otro usuario para asegurar aislamiento
        Song.objects.create(
            title="De otro",
            artist_display_name="Otro",
            owner_user="artist2",
            audio_file="/uploaded_media/otro.mp3",
            visibility="public",
        )
        # Canción propia pero removida (no debe aparecer)
        Song.objects.create(
            title="Oculta",
            artist_display_name="Artista X",
            owner_user="artist",
            audio_file="/uploaded_media/oculta.mp3",
            visibility="removed",
        )

    def test_home_inyecta_playlist_para_artista(self):
        """Un ARTISTA autenticado recibe una playlist 'Mi música' con sus canciones públicas."""
        self.iniciar_sesion("artist", "Artista")
        resp = self.client.get(reverse("home"))
        self.assertEqual(resp.status_code, 200)

        # 1) El HTML trae el contenedor del JSON
        self.assertIn(b'id="playlists-data-json"', resp.content)

        # 2) El contexto expone el JSON de playlists
        playlists_json = resp.context.get("playlists_json")
        self.assertIsInstance(playlists_json, str)

        data = json.loads(playlists_json)
        # Debe haber 1 playlist para el artista
        self.assertEqual(len(data), 1)
        pl = data[0]
        self.assertEqual(pl.get("id"), 1)
        self.assertEqual(pl.get("name"), "Mi música")

        songs = pl.get("songs", [])
        # Deben estar solo las 2 públicas del dueño "artist"
        titulos = {s.get("title") for s in songs}
        self.assertSetEqual(titulos, {"Canción A", "Canción B"})

        # Cada entrada debe exponer campos que el player usa
        for s in songs:
            self.assertIn("title", s)
            self.assertIn("author", s)
            self.assertIn("audioUrl", s)
            # coverUrl puede ser None u omitido; no lo forzamos

    def test_home_no_inyecta_playlist_para_usuario(self):
        """Un USUARIO (no artista) no recibe playlists en el home."""
        self.iniciar_sesion("viewer", "Usuario")
        resp = self.client.get(reverse("home"))
        self.assertEqual(resp.status_code, 200)
        playlists_json = resp.context.get("playlists_json")
        data = json.loads(playlists_json)
        self.assertEqual(data, [])

    def test_home_no_inyecta_playlist_para_admin(self):
        """Un ADMIN tampoco recibe playlists personales en el home."""
        self.iniciar_sesion("admin", "Administrador")
        resp = self.client.get(reverse("home"))
        self.assertEqual(resp.status_code, 200)
        playlists_json = resp.context.get("playlists_json")
        data = json.loads(playlists_json)
        self.assertEqual(data, [])

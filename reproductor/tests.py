"""
Pruebas de integración para el feed JSON del reproductor.

Cubre:
- Entrega de canciones públicas del artista autenticado.
- Respuesta 401 cuando no hay sesión.
- Exclusión de canciones ajenas o con visibilidad 'removed'.
- Estructura mínima requerida por el reproductor.
"""

from django.test import TestCase, Client
from django.urls import reverse, NoReverseMatch
from inicio_sesion.models import Users, Song


class ReproductorTests(TestCase):
    def setUp(self):
        self.client = Client()
        # Artista con una canción pública para el feed JSON
        self.artist, _ = Users.objects.update_or_create(
            user="artist", defaults={"password": "artist123", "type": "Artista", "is_superadmin": False}
        )
        Song.objects.create(
            title="Fuego Interno", artist_display_name="artist", owner_user="artist",
            audio_file="dummy.mp3", visibility="public", genre="rock"
        )
        s = self.client.session
        s["user"] = "artist"
        s["role"] = "Artista"
        s.save()

    def _resolve_first(self, names=(), paths=()):
        for name in names:
            try:
                return reverse(name)
            except NoReverseMatch:
                continue
        for p in paths:
            return p
        return None

    def test_feed_para_reproductor(self):
        """
        Debe devolver canciones públicas del artista autenticado
        en el formato esperado por el reproductor (mi_musica_json).
        """
        url = self._resolve_first(names=("mi_musica_json",), paths=("/mi-musica.json", "/mi-musica/", "/api/mi-musica/"))
        self.assertIsNotNone(url, "No hay ruta para mi_musica_json.")
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data.get("ok"))
        songs = data.get("songs", [])
        self.assertTrue(any(s.get("title") == "Fuego Interno" for s in songs))

    def test_feed_sin_sesion_401(self):
        """Sin sesión debe responder 401 con {'ok': false, 'error': 'auth'}."""
        url = self._resolve_first(names=("mi_musica_json",), paths=("/mi-musica.json", "/mi-musica/", "/api/mi-musica/"))
        self.assertIsNotNone(url, "No hay ruta para mi_musica_json.")

        c = Client()  # Cliente sin sesión
        resp = c.get(url)
        self.assertEqual(resp.status_code, 401)
        data = resp.json()
        self.assertFalse(data.get("ok"))
        self.assertEqual(data.get("error"), "auth")

    def test_feed_excluye_ajenos_y_removed(self):
        """
        Debe incluir únicamente canciones 'public' del artista autenticado,
        excluyendo 'removed' y canciones de otros propietarios.
        """
        # Canción pública adicional del propietario
        Song.objects.create(
            title="Otra Propia", artist_display_name="artist", owner_user="artist",
            audio_file="x2.mp3", visibility="public", genre="rock"
        )
        # Canción del propietario con visibilidad 'removed'
        Song.objects.create(
            title="Borrada", artist_display_name="artist", owner_user="artist",
            audio_file="x3.mp3", visibility="removed", genre="rock"
        )
        # Canción pública de un tercero
        Users.objects.update_or_create(
            user="other", defaults={"password": "x", "type": "Artista", "is_superadmin": False}
        )
        Song.objects.create(
            title="De Otro", artist_display_name="other", owner_user="other",
            audio_file="x4.mp3", visibility="public", genre="jazz"
        )

        url = self._resolve_first(names=("mi_musica_json",), paths=("/mi-musica.json", "/mi-musica/", "/api/mi-musica/"))
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data.get("ok"))
        titles = {s.get("title") for s in data.get("songs", [])}

        self.assertIn("Fuego Interno", titles)   # de setUp
        self.assertIn("Otra Propia", titles)     # pública del propietario
        self.assertNotIn("Borrada", titles)      # 'removed' del propietario
        self.assertNotIn("De Otro", titles)      # pública de tercero

    def test_feed_formato_minimo(self):
        """Cada elemento debe incluir los campos mínimos requeridos por el reproductor."""
        url = self._resolve_first(names=("mi_musica_json",), paths=("/mi-musica.json", "/mi-musica/", "/api/mi-musica/"))
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        song = data.get("songs", [])[0]
        for key in ("id", "title", "artist_display_name", "audio_url", "cover_url", "genre"):
            self.assertIn(key, song, f"Falta campo '{key}' en el payload del feed")

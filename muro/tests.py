# muro/tests.py
"""
Pruebas de integración para el módulo de Muro:
- Subida individual de canciones (flujo principal y validaciones).
- Eliminación (soft delete) y reversión en el muro.
- Subida masiva (límite de cantidad, extensiones permitidas y duplicados por hash).
- Undo tras subida mediante endpoint JSON.
"""

import io
import hashlib
from django.test import TestCase, Client
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse, NoReverseMatch
from inicio_sesion.models import Users, Song


class MuroTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        """Crea usuarios base para las pruebas del muro."""
        cls.artist, _ = Users.objects.update_or_create(
            user='artist', defaults={'password': 'artist123', 'type': 'Artista', 'is_superadmin': False}
        )
        cls.viewer, _ = Users.objects.update_or_create(
            user='viewer', defaults={'password': 'viewer123', 'type': 'Usuario', 'is_superadmin': False}
        )

    def setUp(self):
        self.client = Client()

    # ----------------- Helpers -----------------
    def login_as_artist(self, username='artist'):
        """Inyecta sesión de artista en el cliente de pruebas."""
        session = self.client.session
        session['user'] = username
        session['role'] = 'Artista'
        session.save()

    def _url(self, name, fallback):
        """
        Resuelve una URL por nombre; si no existe, utiliza el fallback literal.
        Si tampoco existe en el enrutamiento, la llamada posterior devolverá 404.
        """
        try:
            return reverse(name)
        except NoReverseMatch:
            return fallback

    def _fake_mp3(self, name='track.mp3'):
        """
        Genera un archivo MP3 mínimo para los tests. La vista no valida el formato
        a nivel de códec; sólo se requieren bytes para el cálculo de SHA-256.
        """
        return SimpleUploadedFile(
            name,
            b'ID3\x04\x00\x00\x00\x00\x00\x21' + b'\x00' * 64,
            content_type='audio/mpeg'
        )

    # ----------------- Casos de uso -----------------
    def test_subir_cancion_ok(self):
        """Sube una canción correctamente y redirige al muro en caso de éxito."""
        self.login_as_artist()
        url = self._url('subir_cancion_en_muro', '/mi-muro/subir/')
        mp3 = self._fake_mp3('Beautiful_Day.mp3')
        data = {
            'title': 'Beautiful Day',
            'artist_display_name': 'U2',
            'genre': 'rock',
            'audio_file': mp3,
        }
        resp = self.client.post(url, data)
        self.assertIn(resp.status_code, (302, 200))
        self.assertTrue(
            Song.objects.filter(
                owner_user='artist',
                title='Beautiful Day',
                visibility='public'
            ).exists()
        )

    def test_subir_cancion_rechaza_titulo_no_logico(self):
        """Rechaza títulos no válidos según la heurística definida en la vista."""
        self.login_as_artist()
        url = self._url('subir_cancion_en_muro', '/mi-muro/subir/')
        mp3 = self._fake_mp3('xfjghsdlkgjhlkghlkgh.mp3')
        data = {
            'title': 'xfjghsdlkgjhlkghlkgh',
            'artist_display_name': 'X',
            'genre': 'indie',
            'audio_file': mp3,
        }
        resp = self.client.post(url, data, follow=True)
        self.assertFalse(
            Song.objects.filter(owner_user='artist', title='xfjghsdlkgjhlkghlkgh').exists()
        )

    def test_eliminar_cancion_ok(self):
        """Realiza soft delete de una canción propia y actualiza visibilidad a 'removed'."""
        s = Song.objects.create(
            title='Para eliminar',
            artist_display_name='Artist',
            owner_user='artist',
            audio_file='uploaded_songs/dummy.mp3',
            visibility='public',
            genre='rock',
            audio_sha256='aa'
        )

        self.login_as_artist()
        url = f'/mi-muro/eliminar/{s.id}/'
        try:
            url = reverse('eliminar_mi_cancion', kwargs={'song_id': s.id})
        except NoReverseMatch:
            pass

        resp = self.client.post(url, {})
        self.assertIn(resp.status_code, (302, 200))
        s.refresh_from_db()
        self.assertEqual(s.visibility, 'removed')


class MuroAdvancedTests(TestCase):
    def setUp(self):
        """Inicializa cliente con sesión de artista para pruebas avanzadas/undo."""
        self.c = Client()
        Users.objects.update_or_create(
            user="artist",
            defaults={"password": "artist123", "type": "Artista", "is_superadmin": False},
        )
        s = self.c.session
        s["user"] = "artist"
        s["role"] = "Artista"
        s.save()

    # ----------------- Helpers -----------------
    def _url(self, name, *args, **kwargs):
        """
        Resuelve una URL por nombre; utiliza rutas literales de respaldo cuando
        el patrón con nombre no está disponible.
        """
        try:
            return reverse(name, args=args, kwargs=kwargs)
        except NoReverseMatch:
            if name == "subir_cancion_en_muro":
                return "/mi-muro/subir/"
            if name == "eliminar_mi_cancion":
                return f"/mi-muro/eliminar/{kwargs.get('song_id')}/"
            if name == "revertir":
                return "/mi-muro/undo/"
            if name == "muro_subida_masiva":
                return "/mi-muro/subida-masiva/"
            return "/"

    def _mk_audio(self, name="a.mp3", payload=b"dummy audio"):
        """Crea un archivo de audio genérico para pruebas de subida."""
        return SimpleUploadedFile(name, payload, content_type="audio/mpeg")

    def _mk_cover(self, name="c.jpg"):
        """Crea una portada mínima para escenarios donde se requiera enviar imagen."""
        return SimpleUploadedFile(name, b"\x89PNG\r\n\x1a\n\x00\x00", content_type="image/png")

    # ----------------- Escenarios de UNDO -----------------
    def test_undo_restore_song_after_delete(self):
        """Revierten eliminación: visibility debe volver de 'removed' a 'public'."""
        song = Song.objects.create(
            title="Tema A", artist_display_name="artist", owner_user="artist",
            audio_file="a.mp3", visibility="public", genre="rock"
        )
        resp = self.c.post(self._url("eliminar_mi_cancion", song_id=song.id))
        self.assertIn(resp.status_code, (302, 303))
        song.refresh_from_db()
        self.assertEqual(song.visibility, "removed")

        resp = self.c.post(self._url("revertir"))
        self.assertIn(resp.status_code, (302, 303))
        song.refresh_from_db()
        self.assertEqual(song.visibility, "public")

    def test_undo_delete_song_after_upload(self):
        """Revierten subida reciente: el undo debe eliminar la canción creada."""
        payload = {
            "title": "Canción Nueva",
            "artist_display_name": "artist",
            "genre": "rock",
        }
        files = {"audio_file": self._mk_audio("n1.mp3")}
        resp = self.c.post(
            self._url("subir_cancion_en_muro"),
            data={**payload, **files},
            format="multipart",
            HTTP_X_REQUESTED_WITH="fetch",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertTrue(data.get("ok"))
        song_id = data["song"]["id"]
        self.assertTrue(Song.objects.filter(id=song_id).exists())

        resp2 = self.c.post(self._url("revertir"))
        self.assertIn(resp2.status_code, (302, 303))
        self.assertFalse(Song.objects.filter(id=song_id).exists())

    # ----------------- Subida masiva -----------------
    def test_subida_masiva_rechaza_demasiados_archivos(self):
        """Rechaza peticiones que superan el máximo de archivos permitido (_MAX_FILES=30)."""
        url = self._url("muro_subida_masiva")
        files = [self._mk_audio(f"x{i}.mp3", b"a") for i in range(0, 31)]
        resp = self.c.post(
            url,
            data={"genre": "rock", "audio_files": files},
            format="multipart",
            HTTP_X_REQUESTED_WITH="fetch",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Máximo permitido: 30", resp.content.decode("utf-8"))

    def test_subida_masiva_extension_invalida(self):
        """Devuelve resultado de error por extensión no admitida dentro del lote."""
        url = self._url("muro_subida_masiva")
        bad = SimpleUploadedFile("malo.txt", b"xxx", content_type="text/plain")
        resp = self.c.post(
            url,
            data={"genre": "rock", "audio_files": [bad]},
            format="multipart",
            HTTP_X_REQUESTED_WITH="fetch",
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        res = data.get("results", [])[0]
        self.assertFalse(res.get("ok"))
        self.assertIn("Extensión no permitida", res.get("error", ""))

    def test_subida_masiva_duplicado_por_hash(self):
        """Detecta y rechaza duplicados exactos de audio por hash para el mismo propietario."""
        content = b"AAAA-same-binary"
        sha = hashlib.sha256(content).hexdigest()
        Song.objects.create(
            title="Ya existe",
            artist_display_name="artist",
            owner_user="artist",
            audio_file="dup.mp3",
            audio_sha256=sha,
            visibility="public",
            genre="rock",
        )

        url = self._url("muro_subida_masiva")
        dup_file = self._mk_audio("nuevo.mp3", content)
        resp = self.c.post(
            url,
            data={"genre": "rock", "audio_files": [dup_file]},
            format="multipart",
            HTTP_X_REQUESTED_WITH="fetch",
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        res = data.get("results", [])[0]
        self.assertFalse(res.get("ok"))
        self.assertIn("Duplicado (mismo audio)", res.get("error", ""))

    def test_subir_cancion_rechaza_tamano_max(self):
        """Rechaza archivos individuales mayores a 10 MB."""
        big = b"x" * (10 * 1024 * 1024 + 1)
        resp = self.c.post(
            self._url("subir_cancion_en_muro"),
            data={
                "title": "Archivo Grande",
                "artist_display_name": "artist",
                "genre": "rock",
                "audio_file": self._mk_audio("big.mp3", big),
            },
            format="multipart",
            HTTP_X_REQUESTED_WITH="fetch",
        )
        self.assertEqual(resp.status_code, 400)
        data = resp.json()
        self.assertFalse(data.get("ok"))
        self.assertIn("excede 10 MB", data.get("error", ""))

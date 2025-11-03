# inicio_sesion/tests/test_subir.py
from django.contrib.messages import get_messages
from django.urls import reverse

from inicio_sesion.models import Song

from .base import BasePruebas

NAME_SUBIR = "subir_cancion_en_muro"  # Vista POST-only que usa el muro del artista


class PruebasSubirCancion(BasePruebas):
    """Pruebas compatibles con el flujo actual de subida en el muro del artista."""

    def test_artista_puede_subir_cancion(self):
        """Un artista autenticado puede subir una canción válida (redirige al muro)."""
        self.iniciar_sesion("artist", "Artista")

        resp = self.client.post(
            reverse(NAME_SUBIR),
            {
                "title": "Preso",
                "artist_display_name": "José José",
                "audio_file": self.mp3_falso("preso.mp3"),
            },
        )
        # Éxito ⇒ redirige a 'mi_muro'
        self.assertEqual(resp.status_code, 302)
        self.assertTrue(
            Song.objects.filter(
                owner_user="artist", title="Preso", visibility="public"
            ).exists()
        )

    def test_rechaza_duplicado_por_titulo_y_dueno(self):
        """Mismo dueño + mismo título ⇒ NO duplica. Muestra mensaje de error."""
        # Canción existente del mismo dueño con mismo título
        Song.objects.create(
            title="Preso",
            artist_display_name="JJ",
            owner_user="artist",
            audio_file="/uploaded_media/a.mp3",
            cover_image=None,
            visibility="public",
        )

        self.iniciar_sesion("artist", "Artista")

        # follow=True para aterrizar en el muro y poder leer mensajes
        resp = self.client.post(
            reverse(NAME_SUBIR),
            {
                "title": "Preso",
                "artist_display_name": "José José",
                "audio_file": self.mp3_falso("otro.mp3"),
            },
            follow=True,
        )

        # Al seguir la redirección, terminamos en 200 (muro)
        self.assertEqual(resp.status_code, 200)

        # No se crea un duplicado
        self.assertEqual(
            Song.objects.filter(owner_user="artist", title="Preso").count(), 1
        )

        # Mensaje de error razonable presente
        msgs = list(get_messages(resp.wsgi_request))
        self.assertTrue(
            any(
                "ya tienes" in str(m).lower() or "título" in str(m).lower()
                for m in msgs
            )
        )

    def test_mismo_titulo_pero_duenos_distintos_se_permite(self):
        """Usuarios diferentes pueden usar el mismo título."""
        # artist ya tiene "Preso"
        Song.objects.create(
            title="Preso",
            artist_display_name="JJ",
            owner_user="artist",
            audio_file="/uploaded_media/a.mp3",
            cover_image=None,
            visibility="public",
        )

        # Ahora lo sube artist2 con mismo título
        self.iniciar_sesion("artist2", "Artista")
        resp = self.client.post(
            reverse(NAME_SUBIR),
            {
                "title": "Preso",
                "artist_display_name": "Otro",
                "audio_file": self.mp3_falso("preso.mp3"),
            },
        )
        self.assertEqual(resp.status_code, 302)
        self.assertTrue(
            Song.objects.filter(owner_user="artist2", title="Preso").exists()
        )

    def test_usuario_no_artista_no_puede_subir(self):
        """Un usuario sin rol de artista NO puede subir (403)."""
        self.iniciar_sesion("viewer", "Usuario")

        resp_post = self.client.post(
            reverse(NAME_SUBIR),
            {
                "title": "X",
                "artist_display_name": "Y",
                "audio_file": self.mp3_falso("x.mp3"),
            },
        )
        self.assertEqual(resp_post.status_code, 403)

from django.test import TestCase, Client
from django.urls import reverse, NoReverseMatch
from inicio_sesion.models import Users, ArtistProfile


def _url_or(name: str, fallback: str) -> str:
    """Intenta resolver la URL con reverse(name); si no existe, usa el fallback literal."""
    try:
        return reverse(name)
    except NoReverseMatch:
        return fallback


class GestionTests(TestCase):
    """
    Pruebas de integración para la app 'gestion'.

    Casos cubiertos:
      - Registro de administrador (flujo principal y a nivel de modelo).
      - Registro de artista (flujo principal; alterno con contraseña corta; descripción larga) y a nivel de modelo.

    Para acceso a las vistas de gestión se asume sesión como 'admin'.
    """

    @classmethod
    def setUpTestData(cls):
        # En este contexto de pruebas, los usuarios base suelen crearse vía migración/seed.
        # Si no existieran, se garantiza un admin funcional para la sesión de pruebas.
        if not Users.objects.filter(user="admin").exists():
            Users.objects.create(
                user="admin",
                password="admin123",
                type="Administrador",
                is_superadmin=True,
            )

    def setUp(self):
        self.c = Client()
        # Inyecta sesión con el usuario 'admin' (el rol se valida en la vista mediante la BD).
        s = self.c.session
        s["user"] = "admin"
        s.save()
        # Resolución de URLs con nombre estándar y fallbacks razonables.
        self.url_gestion = _url_or("gestion", "/gestion/")
        self.url_reg_admin = _url_or("registrar_admin", "/gestion/registrar-admin/")
        self.url_reg_artista = _url_or("registrar_artista", "/gestion/registrar-artista/")

    # -----------------------
    # Registrar ADMINISTRADOR
    # -----------------------

    def test_registrar_admin_model_ok(self):
        """Modelo: creación de administrador simple."""
        Users.objects.create(user="nuevo_admin_model", password="x" * 12, type="Administrador")
        self.assertTrue(
            Users.objects.filter(user="nuevo_admin_model", type="Administrador").exists()
        )

    def test_registrar_admin_ok(self):
        """Flujo principal: POST a registrar_admin crea el usuario y redirige al dashboard."""
        payload = {"user": "nuevo_admin", "password": "segura12345"}
        resp = self.c.post(self.url_reg_admin, payload, follow=False)
        self.assertIn(resp.status_code, (302, 303))
        self.assertTrue(Users.objects.filter(user="nuevo_admin", type__iexact="Administrador").exists())

    # -------------------
    # Registrar ARTISTA
    # -------------------

    def test_registrar_artista_model_ok(self):
        """Modelo: creación de artista y su perfil asociado."""
        u = Users.objects.create(user="nuevo_artista_model", password="1234567890", type="Artista")
        ArtistProfile.objects.create(user=u, description="Cantante indie")
        self.assertTrue(Users.objects.filter(user="nuevo_artista_model", type="Artista").exists())
        self.assertTrue(ArtistProfile.objects.filter(user=u, description__icontains="indie").exists())

    def test_registrar_artista_ok(self):
        """Principal N-1: ID + descripción + password (>=10) ⇒ alta exitosa."""
        payload = {
            "user": "nuevo_artista",
            "password": "contraseña10",   # 11 chars
            "description": "Artista de prueba para el caso principal.",
        }
        resp = self.c.post(self.url_reg_artista, payload, follow=False)
        self.assertIn(resp.status_code, (302, 303))
        self.assertTrue(Users.objects.filter(user="nuevo_artista", type="Artista").exists())
        # Perfil creado con descripción
        u = Users.objects.get(user="nuevo_artista")
        self.assertTrue(ArtistProfile.objects.filter(user=u).exists())

    def test_registrar_artista_password_corta(self):
        """Alterno A-1: password < 10 ⇒ no debe crearse el artista."""
        payload = {
            "user": "artista_pw_corta",
            "password": "123456789",  # 9 caracteres
            "description": "No debería crearse.",
        }
        resp = self.c.post(self.url_reg_artista, payload, follow=False)
        self.assertIn(resp.status_code, (302, 303))
        self.assertFalse(Users.objects.filter(user="artista_pw_corta").exists())

    def test_registrar_artista_descripcion_larga(self):
        """Descripción > 200 ⇒ rechazo."""
        payload = {
            "user": "artista_desc_larga",
            "password": "segura12345",
            "description": "A" * 201,  # 201 chars
        }
        resp = self.c.post(self.url_reg_artista, payload, follow=False)
        self.assertIn(resp.status_code, (302, 303))
        self.assertFalse(Users.objects.filter(user="artista_desc_larga").exists())


def test_registrar_admin_forbidden_para_no_admin(self):
    """Un usuario no-admin no puede acceder a registrar_admin (403)."""
    # Cambia la sesión a 'viewer' (rol Usuario).
    s = self.c.session
    s['user'] = 'viewer'
    s.save()

    resp = self.c.post(self.url_reg_admin, {"user": "intruso", "password": "1234567890"})
    self.assertEqual(resp.status_code, 403)
    self.assertFalse(Users.objects.filter(user="intruso").exists())


from django.test import TestCase, Client  # noqa: E402 (mantener orden para consistencia con el original)
from django.urls import reverse, NoReverseMatch  # noqa: E402
from inicio_sesion.models import Users, Song  # noqa: E402


class GestionCambioUsernameTests(TestCase):
    """
    Pruebas de edición de usuario en gestión:
      - Propagación del cambio de username de artista hacia Song.owner_user.
      - Actualización del username en la sesión cuando el propio admin se renombra.
    """

    def setUp(self):
        self.c = Client()
        # Admin en sesión
        Users.objects.update_or_create(
            user="admin", defaults={"password": "admin123", "type": "Administrador", "is_superadmin": True}
        )
        s = self.c.session
        s["user"] = "admin"
        s["role"] = "Administrador"
        s.save()

        # Artista con una canción
        Users.objects.update_or_create(
            user="artist", defaults={"password": "x", "type": "Artista", "is_superadmin": False}
        )
        self.song = Song.objects.create(
            title="Tema", artist_display_name="artist", owner_user="artist",
            audio_file="t.mp3", visibility="public", genre="rock"
        )

    def _url_editar(self, username):
        """Reversa flexible con fallbacks para distintas convenciones de urls.py."""
        for pattern in (
            lambda: reverse("editar_usuario", args=[username]),
            lambda: reverse("editar_usuario", kwargs={"username": username}),
        ):
            try:
                return pattern()
            except NoReverseMatch:
                continue
        # Fallback común si se usa otra convención de rutas
        return f"/gestion/usuario/{username}/editar/"

    def test_cambio_username_propagado_a_songs(self):
        """Al cambiar el username de un artista, debe reflejarse en Song.owner_user."""
        url = self._url_editar("artist")
        payload = {
            "user": "artist_renamed",
            "password": "",
            "role": "Artista",          # se normaliza a minúsculas en la vista
            "description": "Bio ok",    # requerido para artistas
        }
        resp = self.c.post(url, payload, follow=False)
        self.assertIn(resp.status_code, (302, 303))

        self.song.refresh_from_db()
        self.assertEqual(self.song.owner_user, "artist_renamed")

    def test_cambio_username_propio_actualiza_sesion(self):
        """Si el admin cambia su propio username, la sesión debe actualizarse."""
        url = self._url_editar("admin")
        payload = {
            "user": "admin_new",
            "password": "",
            "role": "Administrador",  # se aceptan administrador/artista/usuario
        }
        resp = self.c.post(url, payload, follow=False)
        self.assertIn(resp.status_code, (302, 303))

        # La sesión del cliente debe reflejar el nuevo username
        self.assertEqual(self.c.session.get("user"), "admin_new")

# inicio_sesion/tests/base.py
import shutil
import tempfile

from django.core.files.storage import FileSystemStorage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase

import inicio_sesion.base as base
from inicio_sesion.models import Users


class BasePruebas(TestCase):
    """
    Clase base para pruebas del módulo 'inicio_sesion'.
    - Crea/actualiza usuarios de prueba una sola vez para todo el módulo.
    - Prepara un directorio temporal como storage para audio/portadas.
    - Expone utilidades para iniciar sesión y fabricar archivos de audio falsos.
    """

    @classmethod
    def setUpTestData(cls):
        """
        Se ejecuta una vez para todo el TestCase.
        Usamos update_or_create para no chocar con usuarios ya sembrados.
        """
        seed = [
            ("artist", "artist123", "Artista", False),
            ("artist2", "artist123", "Artista", False),
            ("viewer", "viewer123", "Usuario", False),
            ("admin", "admin123", "Administrador", True),
        ]
        for username, pwd, rol, superadmin in seed:
            Users.objects.update_or_create(
                user=username,
                defaults={
                    "password": pwd,
                    "type": rol,
                    "is_superadmin": superadmin,
                },
            )

    def setUp(self):
        """
        Antes de cada prueba:
        - Nuevo cliente.
        - Storage temporal y redirección de base._AUDIO_STORAGE para no tocar 'uploaded_media' real.
        - Guardamos el storage previo para restaurarlo en tearDown().
        """
        self.client = Client()
        self.tmpdir = tempfile.mkdtemp(prefix="test_media_")

        # Guardar y reemplazar el storage global utilizado por la app
        self._prev_storage = base._AUDIO_STORAGE
        base._AUDIO_STORAGE = FileSystemStorage(
            location=self.tmpdir,
            base_url="/uploaded_media/",
        )

    def tearDown(self):
        """Restaura el storage previo y borra el directorio temporal."""
        # Restaurar el storage original
        try:
            base._AUDIO_STORAGE = self._prev_storage
        except Exception:
            pass

        shutil.rmtree(self.tmpdir, ignore_errors=True)

    # Utilidades

    def iniciar_sesion(self, usuario: str, rol: str):
        """Guarda 'user' y 'role' en la sesión del cliente de pruebas."""
        s = self.client.session
        s["user"] = usuario
        s["role"] = rol
        s.save()

    def mp3_falso(self, nombre: str = "cancion.mp3", tam: int = 1024):
        """
        Devuelve un archivo .mp3 mínimo (bytes) para usar en formularios de subida.
        - nombre: nombre de archivo visible para Django
        - tam: tamaño del payload (≥ 3 porque ponemos 'ID3' de cabecera)
        """
        tam = max(3, int(tam))
        payload = b"ID3" + b"\x00" * (tam - 3)
        return SimpleUploadedFile(nombre, payload, content_type="audio/mpeg")

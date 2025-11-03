# inicio_sesion/base.py
import os

from django.conf import settings
from django.core.files.storage import FileSystemStorage

_AUDIO_STORAGE = FileSystemStorage(
    location=os.path.join(settings.BASE_DIR, "uploaded_media"),
    base_url="/uploaded_media/",
)

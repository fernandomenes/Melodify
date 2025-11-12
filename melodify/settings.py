"""
Configuración de Django para Melodify (desarrollo local).
"""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# --------------------------- Seguridad / Debug ---------------------------
SECRET_KEY = "django-insecure-dev-only"
DEBUG = True
ALLOWED_HOSTS = ["127.0.0.1", "localhost", "testserver"]

# ------------------------------- Apps -----------------------------------
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Apps del proyecto
    "inicio_sesion.apps.InicioSesionConfig",
    "reproductor",
    "muro",
    "gestion",
    "feed",
]

# ----------------------------- Middleware --------------------------------
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",

    # Silencia mensajes en AJAX de /mi-muro y /gestion
    "inicio_sesion.middleware.AjaxMessageSilencerMiddleware",

    # Evita caché con sesión
    "inicio_sesion.middleware.NoCacheMiddleware",

    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "melodify.urls"
WSGI_APPLICATION = "melodify.wsgi.application"

# ----------------------------- Plantillas --------------------------------
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ------------------------------ Base de datos ----------------------------
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "melodifyDB.sqlite3",
    }
}

# ------------------------------- Locale ----------------------------------
LANGUAGE_CODE = "es-mx"
TIME_ZONE = "America/Mexico_City"
USE_I18N = True
USE_TZ = True

# ----------------------------- Estáticos/Media ---------------------------
STATIC_URL = "/static/"
STATICFILES_DIRS = [
    BASE_DIR / "static",
    BASE_DIR / "feed" / "static",
]
MEDIA_URL = "/uploaded_media/"
MEDIA_ROOT = BASE_DIR / "uploaded_media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Subidas: 0 usa archivo temporal, no memoria
FILE_UPLOAD_MAX_MEMORY_SIZE = 0

# Login / Logout
LOGIN_URL = "/login/"
LOGIN_REDIRECT_URL = "/home/"
LOGOUT_REDIRECT_URL = "/login/"

# --------------------------- Seguridad / Debug ---------------------------
SECRET_KEY = "django-insecure-dev-only"
DEBUG = True
ALLOWED_HOSTS = ["127.0.0.1", "localhost", "testserver", "faenand.pythonanywhere.com"]

# ----------------------------- Estáticos/Media ---------------------------
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"   # <-- necesario en producción

STATICFILES_DIRS = []
if (BASE_DIR / "static").exists():
    STATICFILES_DIRS.append(BASE_DIR / "static")
if (BASE_DIR / "feed" / "static").exists():
    STATICFILES_DIRS.append(BASE_DIR / "feed" / "static")

MEDIA_URL = "/uploaded_media/"
MEDIA_ROOT = BASE_DIR / "uploaded_media"

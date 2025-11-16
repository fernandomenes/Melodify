"""
Configuración de Django para Melodify (compartida: Local / PythonAnywhere / Koyeb).
- Local:            DEBUG=1, sin S3
- PythonAnywhere:   DEBUG=0 o 1, sin S3 (o con S3 si activas USE_S3)
- Koyeb:            DEBUG=0, Whitenoise para estáticos, S3 opcional para media
"""
from pathlib import Path
import os

# ---------------------------------------------------------------------------
# Paths base
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Seguridad / Debug
# ---------------------------------------------------------------------------
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "django-insecure-dev-only")

# Hosts permitidos (puedes extenderlos con DJANGO_ALLOWED_HOSTS="a.com,b.com")
_default_hosts = [
    "127.0.0.1",
    "localhost",
    "testserver",
    "faenand.pythonanywhere.com",
    ".koyeb.app",  # cualquier subdominio *.koyeb.app
]
ALLOWED_HOSTS = (
    [h.strip() for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",") if h.strip()]
    or _default_hosts
)

# CSRF (puedes extender con DJANGO_CSRF_TRUSTED="https://a.com,https://b.com")
_default_csrf = [
    "https://faenand.pythonanywhere.com",
    "https://*.koyeb.app",
]
CSRF_TRUSTED_ORIGINS = (
    [o.strip() for o in os.environ.get("DJANGO_CSRF_TRUSTED", "").split(",") if o.strip()]
    or _default_csrf
)

# HTTPS detrás de proxy (Koyeb)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

# ---------------------------------------------------------------------------
# Apps
# ---------------------------------------------------------------------------
INSTALLED_APPS = [
    # Django
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # Proyecto
    "inicio_sesion.apps.InicioSesionConfig",
    "reproductor",
    "muro",
    "gestion",
    "feed",
]

# ---------------------------------------------------------------------------
# Middleware
#  - Whitenoise justo después de SecurityMiddleware para servir /static en Koyeb
# ---------------------------------------------------------------------------
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",  # <-- IMPORTANTE p/ Koyeb
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

# ---------------------------------------------------------------------------
# Plantillas
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# Base de datos
#  - Por defecto SQLite (local / PA / Koyeb). Si quieres Postgres externo,
#    puedes leer DATABASE_URL aquí y parsearlo (dj-database-url), pero no es
#    obligatorio para arrancar.
# ---------------------------------------------------------------------------
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "melodifyDB.sqlite3",
    }
}

# ---------------------------------------------------------------------------
# Locale
# ---------------------------------------------------------------------------
LANGUAGE_CODE = "es-mx"
TIME_ZONE = "America/Mexico_City"
USE_I18N = True
USE_TZ = True

# ---------------------------------------------------------------------------
# Estáticos
#  - STATICFILES_DIRS se agrega solo si existen carpetas (evita W004)
#  - Whitenoise activos en producción (almacenamiento comprimido con hash)
# ---------------------------------------------------------------------------
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

STATICFILES_DIRS = []
if (BASE_DIR / "static").exists():
    STATICFILES_DIRS.append(BASE_DIR / "static")
if (BASE_DIR / "feed" / "static").exists():
    STATICFILES_DIRS.append(BASE_DIR / "feed" / "static")

STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

# ---------------------------------------------------------------------------
# Media (por defecto local). Si activas USE_S3=1, se usa S3/R2.
# ---------------------------------------------------------------------------
MEDIA_URL = "/uploaded_media/"
MEDIA_ROOT = BASE_DIR / "uploaded_media"

USE_S3 = os.environ.get("USE_S3", "0") == "1"
if USE_S3:
    # Requiere: pip install 'django-storages[boto3]'
    INSTALLED_APPS.append("storages")  # type: ignore
    DEFAULT_FILE_STORAGE = "storages.backends.s3boto3.S3Boto3Storage"
    AWS_ACCESS_KEY_ID = os.environ["AWS_ACCESS_KEY_ID"]
    AWS_SECRET_ACCESS_KEY = os.environ["AWS_SECRET_ACCESS_KEY"]
    AWS_STORAGE_BUCKET_NAME = os.environ["AWS_STORAGE_BUCKET_NAME"]
    # Para Cloudflare R2 u otro endpoint S3-compatible
    AWS_S3_ENDPOINT_URL = os.environ.get("AWS_S3_ENDPOINT_URL")
    AWS_S3_REGION_NAME = os.environ.get("AWS_S3_REGION_NAME", "auto")
    AWS_S3_ADDRESSING_STYLE = "virtual"
    AWS_S3_SIGNATURE_VERSION = "s3v4"

# ---------------------------------------------------------------------------
# Varios
# ---------------------------------------------------------------------------
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Subidas: 0 usa archivo temporal (no RAM)
FILE_UPLOAD_MAX_MEMORY_SIZE = 0

# Login / Logout
LOGIN_URL = "/login/"
LOGIN_REDIRECT_URL = "/home/"
LOGOUT_REDIRECT_URL = "/login/"

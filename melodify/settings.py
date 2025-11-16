"""
Configuración de Django para Melodify (Local / PythonAnywhere / Koyeb).

- Local:            DEBUG=1
- PythonAnywhere:   DEBUG=0/1
- Koyeb:            DEBUG=0, Whitenoise para /static, S3 opcional para /uploaded_media
"""
from pathlib import Path
import os

# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
def env_list(name: str, default: list[str]) -> list[str]:
    raw = os.environ.get(name, "")
    if not raw:
        return default
    return [x.strip() for x in raw.split(",") if x.strip()]

# ---------------------------------------------------------------------------
# Paths base
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Seguridad / Debug
# ---------------------------------------------------------------------------
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "django-insecure-dev-only")

# Hosts permitidos
_DEFAULT_HOSTS = [
    "127.0.0.1",
    "localhost",
    "testserver",
    "faenand.pythonanywhere.com",                 # PythonAnywhere
    ".koyeb.app",                                 # comodín subdominios Koyeb
    "delicate-jemima-faenand-49a4a9ec.koyeb.app", # tu host exacto en Koyeb
]
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", _DEFAULT_HOSTS)

# Orígenes CSRF confiables (esquema https y sin slash final)
_DEFAULT_CSRF = [
    "https://faenand.pythonanywhere.com",
    "https://delicate-jemima-faenand-49a4a9ec.koyeb.app",
]
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED", _DEFAULT_CSRF)

# HTTPS detrás de proxy/reverse-proxy (Koyeb/PA)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True
if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    # Si en algún momento fuerzas HTTPS total, descomenta:
    # SECURE_SSL_REDIRECT = True

# ---------------------------------------------------------------------------
# Apps
# ---------------------------------------------------------------------------
INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles",
    # Apps del proyecto (SIN duplicados)
    "inicio_sesion.apps.InicioSesionConfig",
    "reproductor",
    "muro",
    "gestion",
    "feed",
]

# ---------------------------------------------------------------------------
# Middleware (Whitenoise justo después de SecurityMiddleware)
# ---------------------------------------------------------------------------
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",  # servir /static sin servidor externo
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    # Middlewares propios
    "inicio_sesion.middleware.AjaxMessageSilencerMiddleware",
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
# Base de datos (SQLite por defecto)
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
# Estáticos (Whitenoise)
# ---------------------------------------------------------------------------
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

STATICFILES_DIRS: list[Path] = []
if (BASE_DIR / "static").exists():
    STATICFILES_DIRS.append(BASE_DIR / "static")
if (BASE_DIR / "feed" / "static").exists():
    STATICFILES_DIRS.append(BASE_DIR / "feed" / "static")

# Almacenamiento optimizado con hashes y compresión
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

# ---------------------------------------------------------------------------
# Media (local por defecto). S3/R2 opcional con USE_S3=1
# ---------------------------------------------------------------------------
MEDIA_URL = "/uploaded_media/"
MEDIA_ROOT = BASE_DIR / "uploaded_media"

USE_S3 = os.environ.get("USE_S3", "0") == "1"
if USE_S3:
    # Requiere: pip install "django-storages[boto3]"
    INSTALLED_APPS.append("storages")  # type: ignore
    DEFAULT_FILE_STORAGE = "storages.backends.s3boto3.S3Boto3Storage"
    AWS_ACCESS_KEY_ID = os.environ["AWS_ACCESS_KEY_ID"]
    AWS_SECRET_ACCESS_KEY = os.environ["AWS_SECRET_ACCESS_KEY"]
    AWS_STORAGE_BUCKET_NAME = os.environ["AWS_STORAGE_BUCKET_NAME"]
    AWS_S3_ENDPOINT_URL = os.environ.get("AWS_S3_ENDPOINT_URL")  # opcional (R2)
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

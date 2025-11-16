"""
Configuración de Django para Melodify (Local / PythonAnywhere / Koyeb).

- Local:            DEBUG=1
- PythonAnywhere:   DEBUG=0/1
- Koyeb:            DEBUG=0, WhiteNoise para /static; media/DB en volumen /data
"""
from pathlib import Path
import os

# ------------------------------- Utils -----------------------------------
def env_list(name: str, default: list[str]) -> list[str]:
    raw = os.environ.get(name, "")
    if not raw:
        return default
    return [x.strip() for x in raw.split(",") if x.strip()]

BASE_DIR = Path(__file__).resolve().parent.parent

# --------------------------- Seguridad / Debug ---------------------------
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "django-insecure-dev-only")

_DEFAULT_HOSTS = [
    "127.0.0.1",
    "localhost",
    "testserver",
    "faenand.pythonanywhere.com",                      # PythonAnywhere
    "delicate-jemima-faenand-49a4a9ec.koyeb.app",     # tu URL en Koyeb
    ".koyeb.app",                                     # subdominios Koyeb
]
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", _DEFAULT_HOSTS)

_DEFAULT_CSRF = [
    "https://faenand.pythonanywhere.com",
    "https://delicate-jemima-faenand-49a4a9ec.koyeb.app",
]
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED", _DEFAULT_CSRF)

# HTTPS detrás de proxy (Koyeb/PA)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True
if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    # SECURE_SSL_REDIRECT = True  # opcional

# -------------------------------- Apps -----------------------------------
INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles",
    # Apps del proyecto (sin duplicados)
    "inicio_sesion.apps.InicioSesionConfig",
    "reproductor",
    "muro",
    "gestion",
    "feed",
]

# ------------------------------ Middleware -------------------------------
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",  # sirve /static
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    # Propios
    "inicio_sesion.middleware.AjaxMessageSilencerMiddleware",
    "inicio_sesion.middleware.NoCacheMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "melodify.urls"
WSGI_APPLICATION = "melodify.wsgi.application"

# ------------------------------ Plantillas -------------------------------
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

# ---------------------------- Base de datos ------------------------------
# Usa /data en Koyeb para mantener la DB fuera de la imagen (con Volumen).
DB_PATH = os.environ.get("DJANGO_DB_PATH", str(BASE_DIR / "melodifyDB.sqlite3"))
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": DB_PATH,
    }
}

if os.environ.get("DATABASE_URL"):
    import dj_database_url
    DATABASES["default"] = dj_database_url.parse(
        os.environ["DATABASE_URL"],
        conn_max_age=600,
        ssl_require=True,
    )

# -------------------------------- Locale ---------------------------------
LANGUAGE_CODE = "es-mx"
TIME_ZONE = "America/Mexico_City"
USE_I18N = True
USE_TZ = True

# ------------------------------- Estáticos -------------------------------
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

STATICFILES_DIRS: list[Path] = []
if (BASE_DIR / "static").exists():
    STATICFILES_DIRS.append(BASE_DIR / "static")
if (BASE_DIR / "feed" / "static").exists():
    STATICFILES_DIRS.append(BASE_DIR / "feed" / "static")

# WhiteNoise: hashes + compresión
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"
# En DEBUG permite servir desde finders aunque falte collectstatic:
WHITENOISE_USE_FINDERS = DEBUG

# -------------------------------- Media ----------------------------------
# En Koyeb apunta a /data (persistente) vía DJANGO_MEDIA_ROOT
MEDIA_ROOT = Path(os.environ.get("DJANGO_MEDIA_ROOT", BASE_DIR / "uploaded_media"))
MEDIA_URL = "/uploaded_media/"

# S3/R2 opcional
USE_S3 = os.environ.get("USE_S3", "0") == "1"
if USE_S3:
    INSTALLED_APPS.append("storages")  # type: ignore
    DEFAULT_FILE_STORAGE = "storages.backends.s3boto3.S3Boto3Storage"
    AWS_ACCESS_KEY_ID = os.environ["AWS_ACCESS_KEY_ID"]
    AWS_SECRET_ACCESS_KEY = os.environ["AWS_SECRET_ACCESS_KEY"]
    AWS_STORAGE_BUCKET_NAME = os.environ["AWS_STORAGE_BUCKET_NAME"]
    AWS_S3_ENDPOINT_URL = os.environ.get("AWS_S3_ENDPOINT_URL")
    AWS_S3_REGION_NAME = os.environ.get("AWS_S3_REGION_NAME", "auto")
    AWS_S3_ADDRESSING_STYLE = "virtual"
    AWS_S3_SIGNATURE_VERSION = "s3v4"

# -------------------------------- Varios ---------------------------------
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
FILE_UPLOAD_MAX_MEMORY_SIZE = 0  # evita cargar archivos en RAM

LOGIN_URL = "/login/"
LOGIN_REDIRECT_URL = "/home/"
LOGOUT_REDIRECT_URL = "/login/"

# ------------------------------ Logging ----------------------------------
# Saca errores al stdout (Koyeb los muestra en Logs → Runtime)
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {"class": "logging.StreamHandler"},
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO" if not DEBUG else "DEBUG",
    },
}

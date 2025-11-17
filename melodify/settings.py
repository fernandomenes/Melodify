"""
Configuración de Django para Melodify (Local / PythonAnywhere / Koyeb).

- Local:            DEBUG=1
- PythonAnywhere:   DEBUG=0/1
- Koyeb:            DEBUG=0, WhiteNoise para /static; DB externa (Neon) opcional
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
    "faenand.pythonanywhere.com",
    "delicate-jemima-faenand-49a4a9ec.koyeb.app",
    ".koyeb.app",
]
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", _DEFAULT_HOSTS)

_DEFAULT_CSRF = [
    "https://faenand.pythonanywhere.com",
    "https://delicate-jemima-faenand-49a4a9ec.koyeb.app",
]
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED", _DEFAULT_CSRF)

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True
if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    # SECURE_SSL_REDIRECT = True  # opcional

# -------------------------------- Apps -----------------------------------
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "inicio_sesion.apps.InicioSesionConfig",
    "reproductor",
    "muro",
    "gestion",
    "feed",
]

# ------------------------------ Middleware -------------------------------
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
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

STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}
WHITENOISE_USE_FINDERS = DEBUG

# -------------------------------- Media ----------------------------------
MEDIA_ROOT = Path(os.environ.get("DJANGO_MEDIA_ROOT", BASE_DIR / "uploaded_media"))
MEDIA_URL = "/uploaded_media/"

USE_S3 = os.environ.get("USE_S3", "0") == "1"
if USE_S3:
    INSTALLED_APPS += ["storages"]  # type: ignore
    STORAGES["default"] = {"BACKEND": "storages.backends.s3boto3.S3Boto3Storage"}

    AWS_ACCESS_KEY_ID = os.environ["AWS_ACCESS_KEY_ID"]
    AWS_SECRET_ACCESS_KEY = os.environ["AWS_SECRET_ACCESS_KEY"]
    AWS_STORAGE_BUCKET_NAME = os.environ["AWS_STORAGE_BUCKET_NAME"]
    AWS_S3_ENDPOINT_URL = os.environ.get("AWS_S3_ENDPOINT_URL")
    AWS_S3_REGION_NAME = os.environ.get("AWS_S3_REGION_NAME", "auto")
    AWS_S3_ADDRESSING_STYLE = "virtual"
    AWS_S3_SIGNATURE_VERSION = "s3v4"
    AWS_QUERYSTRING_AUTH = False
    AWS_DEFAULT_ACL = None
    AWS_S3_FILE_OVERWRITE = False
    AWS_S3_OBJECT_PARAMETERS = {"CacheControl": "max-age=31536000, public"}

    AWS_S3_CUSTOM_DOMAIN = os.environ.get("AWS_S3_CUSTOM_DOMAIN")
    if AWS_S3_CUSTOM_DOMAIN:
        MEDIA_URL = f"https://{AWS_S3_CUSTOM_DOMAIN}/"
    elif AWS_S3_ENDPOINT_URL:
        MEDIA_URL = f"{AWS_S3_ENDPOINT_URL.rstrip('/')}/{AWS_STORAGE_BUCKET_NAME}/"

MEDIA_URL = os.environ.get("DJANGO_MEDIA_URL", MEDIA_URL)
# ---- Cloudinary (media) ----
USE_CLOUDINARY = os.environ.get("USE_CLOUDINARY", "0") == "1"
if USE_CLOUDINARY:
    INSTALLED_APPS += ["cloudinary", "cloudinary_storage"]  # type: ignore

    # Al usar DEFAULT_FILE_STORAGE, todas tus ImageField/FileField van a Cloudinary
    DEFAULT_FILE_STORAGE = "cloudinary_storage.storage.MediaCloudinaryStorage"

    # Recursos auto: sube imágenes, audio (Cloudinary trata mp3 como 'video'), etc.
    CLOUDINARY_STORAGE = {
        "RESOURCE_TYPE": "auto",
        "FOLDER": "uploaded_media",  # conserva estructura relativa
        # "OVERWRITE": True,         # opcional: permite re-subir mismo public_id
        # "UNIQUE_FILENAME": False,  # opcional: respeta nombre de archivo
    }

    # Opcional: si definiste DJANGO_MEDIA_URL en env, úsalo; si no, Cloudinary genera las URLs
    MEDIA_URL = os.environ.get("DJANGO_MEDIA_URL", MEDIA_URL)

# -------------------------------- Varios ---------------------------------
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
FILE_UPLOAD_MAX_MEMORY_SIZE = 0

LOGIN_URL = "/login/"
LOGIN_REDIRECT_URL = "/home/"
LOGOUT_REDIRECT_URL = "/login/"

# ------------------------------ Logging ----------------------------------
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

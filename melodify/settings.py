"""
Configuración de Django para Melodify (entorno de desarrollo local).
"""

from pathlib import Path

# ---------------------------------------------------------------------
# Rutas base
# ---------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------
# Seguridad y depuración
# ---------------------------------------------------------------------
SECRET_KEY = "django-insecure-9qhu9wz8-x4-d+l&qr8-cepg0ijh_+$4l=ea!c+)v@i8$h&6dl"
DEBUG = True
ALLOWED_HOSTS = ["127.0.0.1", "localhost", "testserver"]

# ---------------------------------------------------------------------
# Aplicaciones instaladas
# ---------------------------------------------------------------------
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Aplicaciones del proyecto
    "inicio_sesion.apps.InicioSesionConfig",
    "reproductor",
    "muro",
    "gestion",
    "feed",
]

# ---------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    'inicio_sesion.middleware.NoCacheMiddleware', 
]

# ---------------------------------------------------------------------
# Enrutamiento y WSGI
# ---------------------------------------------------------------------
ROOT_URLCONF = "melodify.urls"
WSGI_APPLICATION = "melodify.wsgi.application"

# ---------------------------------------------------------------------
# Plantillas
# ---------------------------------------------------------------------
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

# ---------------------------------------------------------------------
# Base de datos
# ---------------------------------------------------------------------
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "melodifyDB.sqlite3",
    }
}

# ---------------------------------------------------------------------
# Validadores de contraseña
# ---------------------------------------------------------------------
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ---------------------------------------------------------------------
# Internacionalización y zona horaria
# ---------------------------------------------------------------------
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# ---------------------------------------------------------------------
# Archivos estáticos y multimedia
# ---------------------------------------------------------------------
STATIC_URL = "/static/"
STATICFILES_DIRS = [
    BASE_DIR / "static",
    BASE_DIR / "feed" / "static",  # Activos de la aplicación "feed"
]

MEDIA_URL = "/uploaded_media/"
MEDIA_ROOT = BASE_DIR / "uploaded_media"

# ---------------------------------------------------------------------
# Configuración general
# ---------------------------------------------------------------------
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# 0 fuerza el uso de archivo temporal para subidas
FILE_UPLOAD_MAX_MEMORY_SIZE = 0

# ---------------------------------------------------------------------
# Redirecciones de autenticación
# ---------------------------------------------------------------------
LOGIN_URL = "/login/"
LOGIN_REDIRECT_URL = "/home/"
LOGOUT_REDIRECT_URL = "/login/"

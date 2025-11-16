#!/bin/sh
set -e

# Migraciones (con fallback por si 0018 molestara)
if ! python manage.py migrate --noinput; then
  echo "Migrate falló; intentando fake de 0018 y reintentar…"
  python manage.py migrate inicio_sesion 0018 --fake || true
  python manage.py migrate --noinput
fi

# Arranca Gunicorn
exec gunicorn melodify.wsgi:application \
  --bind 0.0.0.0:${PORT:-8000} \
  --workers 2 --threads 8 --timeout 120

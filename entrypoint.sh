#!/bin/sh
set -e

# Static (si usas S3 para static, quita esta línea; aquí está bien porque usamos Whitenoise local)
python manage.py collectstatic --noinput

# Migraciones a la DB externa
python manage.py migrate --noinput

# Arranca Gunicorn
exec gunicorn melodify.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 2 --threads 8 --timeout 120

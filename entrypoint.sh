#!/bin/sh
set -e

# ---------- Espera a la BD (si hay DATABASE_URL) ----------
if [ -n "${DATABASE_URL:-}" ]; then
  echo "Esperando a la base de datos…"
  i=0
  until python - <<'PY' >/dev/null 2>&1
import os
os.environ.setdefault("DJANGO_SETTINGS_MODULE","melodify.settings")
import django
django.setup()
from django.db import connection
with connection.cursor() as cur:
    cur.execute("SELECT 1")
PY
  do
    i=$((i+1))
    if [ "$i" -ge "${DB_WAIT_RETRIES:-30}" ]; then
      echo "No se pudo conectar a la BD tras $i intentos."
      exit 1
    fi
    sleep "${DB_WAIT_SLEEP:-2}"
  done
fi

# ---------- Migrate con fallback (issue 0018) ----------
if ! python manage.py migrate --noinput; then
  echo "Migrate falló; intentando fake de inicio_sesion 0018 y reintentar…"
  python manage.py migrate inicio_sesion 0018 --fake || true
  python manage.py migrate --noinput
fi

# ---------- collectstatic en runtime ----------
if [ "${COLLECTSTATIC_ON_STARTUP:-0}" = "1" ]; then
  python manage.py collectstatic --noinput || true
fi

# ---------- Usuarios iniciales (sin contenido demo) ----------
if [ "${SEED_ON_DEPLOY:-1}" = "1" ]; then
  echo "→ ensure_initial_users…"
  python manage.py ensure_initial_users || true
fi

# ---------- Gunicorn ----------
exec gunicorn melodify.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${GUNICORN_WORKERS:-2}" \
  --threads "${GUNICORN_THREADS:-8}" \
  --timeout "${GUNICORN_TIMEOUT:-120}"

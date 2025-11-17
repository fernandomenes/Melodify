#!/bin/sh
set -e

# Migraciones (con fallback si una específica diera lata)
if ! python manage.py migrate --noinput; then
  echo "Migrate falló; intentando fake de 0018 y reintentar…"
  python manage.py migrate inicio_sesion 0018 --fake || true
  python manage.py migrate --noinput
fi

# Seed en cada deploy (idempotente). Controlable por env.
if [ "${SEED_ON_DEPLOY:-1}" = "1" ]; then
  echo "→ ensure_initial_users…"
  python manage.py ensure_initial_users || true

  echo "→ seed_demo…"
  python manage.py seed_demo \
    --root "${SEED_ROOT:-seeds/artists}" \
    --default-pass "${SEED_DEFAULT_PASS:-demo123}" \
    || true
fi

# Arranca Gunicorn
exec gunicorn melodify.wsgi:application \
  --bind 0.0.0.0:${PORT:-8000} \
  --workers 2 --threads 8 --timeout 120

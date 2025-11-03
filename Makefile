# --- Rutas de Python dentro del entorno virtual ---
PY  := .venv/bin/python
PIP := .venv/bin/pip

# --- Declaración de objetivos “fónicos” ---
.PHONY: setup init-dirs makemigrations migrate seed run runnet dev \
        clean clean-pyc clean-build clean-media clean-db reset-db \
        precommit-clean superclean clean-migrations test coverage  # [NEW]

# setup:
# 1) Crea el entorno virtual local (.venv)
# 2) Actualiza pip dentro del venv
# 3) Instala dependencias del proyecto (Django, Pillow, etc.)
setup:
	python3 -m venv .venv
	$(PIP) install -U pip
	$(PIP) install -r requirements.txt

# init-dirs:
# Crea carpetas locales no versionadas (ignoradas por .gitignore):
# - uploaded_media: almacenamiento de audio/portadas (FileSystemStorage)
# - static: raíz de estáticos para dev
init-dirs:
	mkdir -p uploaded_media static
	mkdir -p uploaded_media/audio/artist uploaded_media/uploaded_avatars  # [NEW]

# makemigrations:
# Genera migraciones pendientes para la app (idempotente si no hay cambios).
makemigrations:
	$(PY) manage.py makemigrations inicio_sesion

# migrate:
# Aplica todas las migraciones contra la BD local (SQLite).
migrate:
	$(PY) manage.py migrate

# seed:
# Carga/actualiza usuarios de prueba de forma idempotente.
# - admin/admin123 (Administrador, is_superadmin=True)
# - artist/artist123 (Artista)
# - viewer/viewer123 (Usuario)
seed:
	$(PY) manage.py shell -c "from inicio_sesion.models import Users; seed=[{'user':'admin','password':'admin123','type':'Administrador','is_superadmin':True},{'user':'artist','password':'artist123','type':'Artista','is_superadmin':False},{'user':'viewer','password':'viewer123','type':'Usuario','is_superadmin':False}]; [Users.objects.update_or_create(user=u['user'], defaults={'password':u['password'],'type':u['type'],'is_superadmin':u['is_superadmin']}) for u in seed]; print('OK: usuarios creados/actualizados')"

# run:
# Arranca el servidor de desarrollo en 127.0.0.1:8000 (solo local)
run:
	$(PY) manage.py runserver

# runnet:
# Arranca para red local en 0.0.0.0:8000 (accesible desde tu LAN)
runnet:
	$(PY) manage.py runserver 0.0.0.0:8000

# dev:
# Pipeline local completo:
# venv → deps → dirs → makemigrations → migrate → seed → run
dev: setup init-dirs makemigrations migrate seed run

# ================== LIMPIEZA (SEGURO) ==================  [NEW]

# clean:
# Limpieza de artefactos locales de desarrollo.
# (Conserva .venv para no romper el entorno; si quieres borrarlo usa clean-venv manual)
clean: clean-pyc clean-build
	@echo "✓ Limpieza básica completa (pyc/build)."

# Borrar caches de Python
clean-pyc:
	@echo "→ Borrando cachés de Python…"
	@find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	@find . -type f -name "*.py[co]" -delete 2>/dev/null || true
	@rm -rf .pytest_cache .ruff_cache 2>/dev/null || true
	@echo "✓ Cachés de Python eliminados."

# Borrar artefactos de build (si existieran)
clean-build:
	@echo "→ Borrando artefactos de build…"
	@rm -rf build dist *.egg-info 2>/dev/null || true
	@echo "✓ Artefactos de build eliminados."

# Borrar SOLO archivos subidos (audios/portadas/avatares), manteniendo estructura
clean-media:
	@echo "→ Limpiando uploaded_media/…"
	@mkdir -p uploaded_media/audio/artist uploaded_media/uploaded_avatars
	@rm -rf uploaded_media/audio/artist/* || true
	@rm -rf uploaded_media/uploaded_avatars/* || true
	@rm -f  uploaded_media/cover_* || true
	@rm -f  uploaded_media/audio_* || true
	@find uploaded_media -maxdepth 1 -type f -delete 2>/dev/null || true
	@echo "✓ Media limpia."

# Eliminar la base de datos SQLite local
clean-db:
	@echo "→ Eliminando base de datos SQLite…"
	@rm -f melodifyDB.sqlite3 2>/dev/null || true
	@echo "✓ Base de datos eliminada."

# Resetea DB desde cero (NO toca migraciones)
reset-db: clean-db migrate
	@echo "✓ DB reseteada (migraciones aplicadas)."

# Limpia caché de pre-commit (si lo usas)
precommit-clean:
	@pre-commit clean || true
	@echo "✓ pre-commit cache limpiado."

# Limpieza fuerte pero segura (NO toca migraciones ni .venv)
superclean: clean clean-media clean-db
	@echo "✓ Superclean completo (sin tocar migraciones ni .venv)."

# ============ OPERACIÓN PELIGROSA: MIGRACIONES ============  [NEW]
# Elimina TODAS las migraciones del app (excepto __init__.py).
# ÚSALO SOLO si vas a reconstruir migraciones desde cero.
# Requiere confirmación: make clean-migrations confirm=YES
clean-migrations:
	@if [ "$(confirm)" != "YES" ]; then \
	  echo "⚠️  Esto borrará TODAS las migraciones de inicio_sesion (excepto __init__.py)."; \
	  echo "    Ejecuta: make clean-migrations confirm=YES"; \
	  exit 1; \
	fi
	@echo "→ Eliminando migraciones (excepto __init__.py)…"
	@find inicio_sesion/migrations -type f ! -name "__init__.py" -delete 2>/dev/null || true
	@echo "✓ Migraciones eliminadas. Recuerda: make makemigrations && make migrate"

# ================== TESTS / COVERAGE ==================
test:
	$(PY) manage.py test inicio_sesion -v 2 --pattern="test_*.py"

coverage:
	$(PIP) install -U coverage
	. .venv/bin/activate; coverage run manage.py test inicio_sesion -v 2 --pattern="test_*.py"; coverage report -m

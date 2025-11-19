# --- Rutas de Python dentro del entorno virtual ---
PY  := .venv/bin/python
PIP := .venv/bin/pip

# --- Config de seed (modificable por env) ---
SEED_ROOT          ?= seeds/artists
SEED_DEFAULT_PASS  ?= demo123

# --- Declaración de objetivos “fónicos” ---
.PHONY: setup init-dirs makemigrations migrate seed seed-users seed-demo run runnet dev \
        clean clean-pyc clean-build clean-media clean-db reset-db \
        precommit-clean superclean clean-migrations test coverage test-app

# setup:
setup:
	python3 -m venv .venv
	$(PIP) install -U pip
	$(PIP) install -r requirements.txt

# init-dirs:
init-dirs:
	mkdir -p uploaded_media static
	mkdir -p uploaded_media/audio/artist uploaded_media/uploaded_avatars

# makemigrations:
makemigrations:
	$(PY) manage.py makemigrations

# migrate:
migrate:
	$(PY) manage.py migrate

# ====== SEED ======
# Usuarios base (ensure_initial_users)
seed-users:
	$(PY) manage.py ensure_initial_users

# Demo de artistas/canciones/portadas/avatares
seed-demo:
	$(PY) manage.py seed_demo --root $(SEED_ROOT) --default-pass $(SEED_DEFAULT_PASS)

# seed rápido (usuarios + demo)
seed: seed-users seed-demo

# run:
run:
	$(PY) manage.py runserver

# runnet:
runnet:
	$(PY) manage.py runserver 0.0.0.0:8000

# dev: venv → deps → dirs → makemigrations → migrate → seed → run
dev: setup init-dirs makemigrations migrate seed run

# ================== LIMPIEZA ==================
clean: clean-pyc clean-build
	@echo "✓ Limpieza básica completa (pyc/build)."

clean-pyc:
	@echo "→ Borrando cachés de Python…"
	@find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	@find . -type f -name "*.py[co]" -delete 2>/dev/null || true
	@rm -rf .pytest_cache .ruff_cache 2>/dev/null || true
	@echo "✓ Cachés de Python eliminados."

clean-build:
	@echo "→ Borrando artefactos de build…"
	@rm -rf build dist *.egg-info 2>/dev/null || true
	@echo "✓ Artefactos de build eliminados."

clean-media:
	@echo "→ Limpiando uploaded_media/…"
	@mkdir -p uploaded_media/audio/artist uploaded_media/uploaded_avatars
	@rm -rf uploaded_media/audio/artist/* || true
	@rm -rf uploaded_media/uploaded_avatars/* || true
	@find uploaded_media -maxdepth 1 -type f -delete 2>/dev/null || true
	@echo "✓ Media limpia."

clean-db:
	@echo "→ Eliminando base de datos SQLite…"
	@rm -f melodifyDB.sqlite3 2>/dev/null || true
	@echo "✓ Base de datos eliminada."

reset-db: clean-db migrate
	@echo "✓ DB reseteada (migraciones aplicadas)."

precommit-clean:
	@pre-commit clean || true
	@echo "✓ pre-commit cache limpiado."

superclean: clean clean-media clean-db
	@echo "✓ Superclean completo (sin tocar migraciones ni .venv)."

# ============ MIGRACIONES PELIGROSAS ============
clean-migrations:
	@if [ "$(confirm)" != "YES" ]; then \
	  echo "    Esto borrará TODAS las migraciones de inicio_sesion (excepto __init__.py)."; \
	  echo "    Ejecuta: make clean-migrations confirm=YES"; \
	  exit 1; \
	fi
	@echo "→ Eliminando migraciones (excepto __init__.py)…"
	@find inicio_sesion/migrations -type f ! -name "__init__.py" -delete 2>/dev/null || true
	@echo "✓ Migraciones eliminadas. Recuerda: make makemigrations && make migrate"

# ================== TESTS / COVERAGE ==================
test:
	$(PY) manage.py test -v 2

test-app:
	$(PY) manage.py test $(APPS) -v 2

coverage:
	$(PIP) install -U coverage
	. .venv/bin/activate; coverage run manage.py test -v 2; coverage report -m

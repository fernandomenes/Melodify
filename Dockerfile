FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Paquetes básicos
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Dependencias
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Código
COPY . .

# Genera estáticos en build (Whitenoise los servirá)
RUN python manage.py collectstatic --noinput

# Usuario no root
RUN useradd -m appuser
USER appuser

ENV PORT=8000
EXPOSE 8000

# Migra y arranca gunicorn en el puerto que Koyeb te pase por $PORT
CMD sh -c "python manage.py migrate --noinput && \
           gunicorn melodify.wsgi:application --bind 0.0.0.0:${PORT} --workers 3 --timeout 120"

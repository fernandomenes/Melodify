FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Dependencias del sistema mínimas (opcional, Pillow ya trae wheel manylinux)
# RUN apt-get update && apt-get install -y --no-install-recommends \
#     libjpeg62-turbo zlib1g && \
#     rm -rf /var/lib/apt/lists/*

# Instala dependencias de Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia el código
COPY . .

# Genera estáticos en build (WhiteNoise los servirá en runtime)
RUN python manage.py collectstatic --noinput

# Puerto expuesto
ENV PORT=8000
EXPOSE 8000

# Arranque: aplica migraciones y levanta gunicorn (evita 500 por migraciones pendientes)
CMD bash -lc "python manage.py migrate --noinput && gunicorn melodify.wsgi:application --bind 0.0.0.0:${PORT} --workers 2 --threads 8 --timeout 120"

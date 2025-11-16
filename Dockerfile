FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Asegura permisos de entrypoint
RUN chmod +x /app/entrypoint.sh

ENV PORT=8000
EXPOSE 8000

# Ejecuta collectstatic + migrate en runtime (con env vars)
CMD ["sh","-c","python manage.py migrate --noinput && python manage.py collectstatic --noinput && gunicorn melodify.wsgi:application --bind 0.0.0.0:8000 --workers 2 --threads 8 --timeout 120"]

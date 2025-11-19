FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Dependencias
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Código
COPY . .

# Estáticos (WhiteNoise usará el manifest en runtime)
RUN python manage.py collectstatic --noinput

# Puerto
ENV PORT=8000
EXPOSE 8000

# Entrypoint (migraciones + gunicorn)
CMD ["./entrypoint.sh"]

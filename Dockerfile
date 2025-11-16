FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Genera estáticos en build; Whitenoise los servirá en runtime
RUN python manage.py collectstatic --noinput

# Puerto HTTP
ENV PORT=8000
EXPOSE 8000

# Arranque del server
CMD ["gunicorn","melodify.wsgi:application","--bind","0.0.0.0:8000","--workers","2","--threads","8","--timeout","120"]

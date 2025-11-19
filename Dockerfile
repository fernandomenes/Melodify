FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUTF8=1 \
    LC_ALL=C.UTF-8 \
    LANG=C.UTF-8

WORKDIR /app

# Dependencias Python
COPY requirements.txt .
RUN pip install --no-cache-dir -U pip \
 && pip install --no-cache-dir -r requirements.txt

# Código
COPY . .

RUN sed -i 's/\r$//' entrypoint.sh && chmod +x entrypoint.sh

RUN python manage.py collectstatic --noinput

EXPOSE 8000

CMD ["./entrypoint.sh"]

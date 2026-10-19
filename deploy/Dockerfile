FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements-production.txt ./
RUN pip install --no-cache-dir -r requirements-production.txt && useradd --uid 10001 --create-home rdm
COPY app ./app
COPY migrations ./migrations
COPY config.py run.py ./
COPY deploy/wsgi.py deploy/initialize.py deploy/seed_users.py ./deploy/
RUN mkdir -p /data /app/app/data && chown -R rdm:rdm /data /app/app/data
USER rdm
EXPOSE 8000
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "4", "--timeout", "60", "--access-logfile", "-", "deploy.wsgi:app"]

FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py ./

# -u flushes stdout so `docker compose logs -f` shows events immediately.
CMD ["python", "-u", "main.py"]

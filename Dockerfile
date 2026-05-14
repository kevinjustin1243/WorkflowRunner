# ── Stage 1: build React frontend ────────────────────────────────────────────
FROM node:20-alpine AS frontend

WORKDIR /app/client
COPY client/package.json client/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY client/ ./
RUN pnpm build


# ── Stage 2: Python runtime ───────────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

COPY server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY server/ ./server/
COPY --from=frontend /app/client/dist ./client/dist

RUN mkdir -p server/workflows

EXPOSE 8000

CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8000"]

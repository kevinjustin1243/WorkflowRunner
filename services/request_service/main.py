"""Service A — Workflow Request Service.

Exposes POST /request. Mints a requestId, publishes a Kafka event to the
designated topic, returns the requestId synchronously. Workflow execution
happens asynchronously downstream via Service B (see services/listener_service).

State is persisted to Postgres (`requests` table): requestId -> {workflow,
status, created_at, payload}. Survives Service A restarts.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

import asyncpg
from aiokafka import AIOKafkaProducer
from aiokafka.errors import KafkaConnectionError
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

KAFKA_BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP", "localhost:9092")
KAFKA_TOPIC = os.environ.get("KAFKA_TOPIC", "workflow.requests")
SERVICE_TOKEN = os.environ.get("REQUEST_SERVICE_TOKEN", "").strip()
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://workflowrunner:changeme@localhost:5432/workflowrunner",
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("request-service")

producer: AIOKafkaProducer | None = None
pg_pool: Optional[asyncpg.Pool] = None

# Each service owns its own DDL — schemas are idempotent so re-creates on
# every boot are free. Keeps deploy ordering decoupled.
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS requests (
    request_id TEXT PRIMARY KEY,
    workflow   TEXT NOT NULL,
    status     TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload    JSONB
);
CREATE INDEX IF NOT EXISTS requests_created_at_idx ON requests(created_at DESC);
"""


async def _connect_pg() -> asyncpg.Pool:
    last_err: Exception | None = None
    for attempt in range(1, 31):
        try:
            pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
            async with pool.acquire() as c:
                await c.execute(SCHEMA_SQL)
            log.info("postgres connected (%s)", DATABASE_URL.split("@")[-1])
            return pool
        except Exception as e:
            last_err = e
            log.warning("postgres not ready (attempt %d/30): %s", attempt, e)
            await asyncio.sleep(2)
    raise RuntimeError(f"postgres unreachable: {last_err}")


async def _connect_kafka() -> AIOKafkaProducer:
    p = AIOKafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        acks="all",
        enable_idempotence=True,
    )
    last_err: Exception | None = None
    for attempt in range(1, 31):
        try:
            await p.start()
            log.info("kafka producer connected to %s topic=%s", KAFKA_BOOTSTRAP, KAFKA_TOPIC)
            return p
        except KafkaConnectionError as e:
            last_err = e
            log.warning("kafka not ready (attempt %d/30): %s", attempt, e)
            await asyncio.sleep(2)
    raise RuntimeError(f"kafka producer failed to connect: {last_err}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global producer, pg_pool
    pg_pool = await _connect_pg()
    producer = await _connect_kafka()
    try:
        yield
    finally:
        if producer is not None:
            await producer.stop()
        if pg_pool is not None:
            await pg_pool.close()


app = FastAPI(title="Workflow Request Service", lifespan=lifespan)


class RequestBody(BaseModel):
    workflow: str
    payload: dict[str, Any] | None = None


def _check_auth(token: str | None) -> None:
    if not SERVICE_TOKEN:
        return  # auth disabled
    if not token or token != SERVICE_TOKEN:
        raise HTTPException(401, "Invalid service token")


@app.post("/request")
async def submit_request(
    body: RequestBody,
    x_service_token: str | None = Header(default=None),
):
    _check_auth(x_service_token)
    workflow = (body.workflow or "").strip()
    if not workflow or "/" in workflow or "\\" in workflow:
        raise HTTPException(422, "workflow must be a plain filename (no path separators)")

    request_id = "req_" + uuid4().hex[:12]
    payload = body.payload or {}
    created_at = datetime.now(timezone.utc).isoformat()
    event = {
        "request_id": request_id,
        "workflow": workflow,
        "payload": payload,
        "ts": created_at,
    }
    assert producer is not None and pg_pool is not None

    # Persist first, then publish. If publish fails we roll the row back to
    # avoid a 'queued' record without a corresponding Kafka message.
    async with pg_pool.acquire() as c:
        await c.execute(
            """INSERT INTO requests (request_id, workflow, status, created_at, payload)
               VALUES ($1,$2,'queued',$3,$4::jsonb)""",
            request_id, workflow, created_at, json.dumps(payload),
        )
    try:
        await producer.send_and_wait(KAFKA_TOPIC, event, key=request_id.encode())
    except Exception as e:
        # Roll back the row so the caller can safely retry.
        async with pg_pool.acquire() as c:
            await c.execute("DELETE FROM requests WHERE request_id=$1", request_id)
        log.exception("publish failed for request_id=%s", request_id)
        raise HTTPException(503, f"failed to publish: {e}") from e

    log.info("queued request_id=%s workflow=%s", request_id, workflow)
    return {"requestId": request_id, "status": "queued"}


@app.get("/request/{request_id}")
async def get_request(request_id: str):
    assert pg_pool is not None
    async with pg_pool.acquire() as c:
        row = await c.fetchrow(
            "SELECT request_id, workflow, status, created_at FROM requests WHERE request_id=$1",
            request_id,
        )
    if not row:
        raise HTTPException(404, "Unknown requestId")
    return {
        "requestId": row["request_id"],
        "workflow": row["workflow"],
        "status": row["status"],
        "created_at": row["created_at"],
    }


@app.get("/health")
async def health():
    kafka_ok = bool(producer and not producer._closed)
    db_ok = False
    if pg_pool is not None:
        try:
            async with pg_pool.acquire() as c:
                db_ok = (await c.fetchval("SELECT 1")) == 1
        except Exception:
            db_ok = False
    return {
        "ok": kafka_ok and db_ok,
        "kafka": kafka_ok,
        "db": db_ok,
        "kafka_bootstrap": KAFKA_BOOTSTRAP,
        "topic": KAFKA_TOPIC,
        "auth_required": bool(SERVICE_TOKEN),
    }

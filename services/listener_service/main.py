"""Service B — Workflow Listener Service.

Subscribes to the Kafka topic. For each event, looks up the referenced
workflow in the Postgres `workflows` table (shared with the runner), extracts
its webhook_token, and POSTs to {WR_BASE_URL}/hooks/workflow/{file}?token=…
to trigger the run. The Kafka requestId rides as the X-Request-Id header so
operators can correlate request → run_id in the logs.

Service B is a worker — no HTTP surface.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.parse
import urllib.request
from typing import Optional

import asyncpg
import yaml
from aiokafka import AIOKafkaConsumer
from aiokafka.errors import KafkaConnectionError

KAFKA_BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP", "localhost:9092")
KAFKA_TOPIC = os.environ.get("KAFKA_TOPIC", "workflow.requests")
KAFKA_GROUP = os.environ.get("KAFKA_GROUP", "workflow-listener")
WR_BASE_URL = os.environ.get("WR_BASE_URL", "http://workflow-runner:8000").rstrip("/")
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://workflowrunner:changeme@localhost:5432/workflowrunner",
)
HTTP_TIMEOUT = float(os.environ.get("WR_HTTP_TIMEOUT", "10"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("listener")

pg_pool: Optional[asyncpg.Pool] = None


async def _connect_pg() -> asyncpg.Pool:
    last_err: Exception | None = None
    for attempt in range(1, 31):
        try:
            pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=3)
            # Sanity probe — listener only reads the workflows table.
            async with pool.acquire() as c:
                await c.execute("SELECT 1")
            log.info("postgres connected (%s)", DATABASE_URL.split("@")[-1])
            return pool
        except Exception as e:
            last_err = e
            log.warning("postgres not ready (attempt %d/30): %s", attempt, e)
            await asyncio.sleep(2)
    raise RuntimeError(f"postgres unreachable: {last_err}")


async def webhook_token_for(workflow: str) -> str | None:
    """Look up a workflow's webhook_token from the shared Postgres table.

    Returns None for any drop-the-message case (unknown workflow, unparseable
    YAML, no webhook_token field).
    """
    if not workflow or "/" in workflow or "\\" in workflow:
        return None
    assert pg_pool is not None
    async with pg_pool.acquire() as c:
        row = await c.fetchrow(
            "SELECT content FROM workflows WHERE filename=$1", workflow
        )
    if not row:
        return None
    try:
        wf = yaml.safe_load(row["content"]) or {}
    except yaml.YAMLError:
        return None
    token = wf.get("webhook_token")
    return str(token) if token else None


def trigger_run(workflow: str, token: str, request_id: str) -> tuple[int, str]:
    """POST to the runner's webhook endpoint. Blocking — call via to_thread."""
    url = (
        f"{WR_BASE_URL}/hooks/workflow/{urllib.parse.quote(workflow)}"
        f"?token={urllib.parse.quote(token)}"
    )
    body = json.dumps({"request_id": request_id}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Request-Id": request_id,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        return resp.status, resp.read().decode("utf-8", "replace")


async def _start_consumer() -> AIOKafkaConsumer:
    consumer = AIOKafkaConsumer(
        KAFKA_TOPIC,
        bootstrap_servers=KAFKA_BOOTSTRAP,
        group_id=KAFKA_GROUP,
        value_deserializer=lambda b: json.loads(b.decode("utf-8")),
        auto_offset_reset="earliest",
        enable_auto_commit=True,
    )
    last_err: Exception | None = None
    for attempt in range(1, 31):
        try:
            await consumer.start()
            return consumer
        except KafkaConnectionError as e:
            last_err = e
            log.warning("kafka not ready (attempt %d/30): %s", attempt, e)
            await asyncio.sleep(2)
    raise RuntimeError(f"kafka consumer failed to connect: {last_err}")


async def consume() -> None:
    global pg_pool
    pg_pool = await _connect_pg()
    consumer = await _start_consumer()
    log.info(
        "subscribed topic=%s bootstrap=%s group=%s wr=%s",
        KAFKA_TOPIC, KAFKA_BOOTSTRAP, KAFKA_GROUP, WR_BASE_URL,
    )
    try:
        async for msg in consumer:
            ev = msg.value or {}
            request_id = ev.get("request_id") or "?"
            workflow = ev.get("workflow") or ""
            log.info("event request_id=%s workflow=%s offset=%s", request_id, workflow, msg.offset)

            token = await webhook_token_for(workflow)
            if not token:
                # Bad message or misconfigured workflow — log loudly and skip
                # rather than crash-loop on a poison pill.
                log.error(
                    "drop request_id=%s: workflow=%r has no webhook_token (or is missing)",
                    request_id, workflow,
                )
                continue

            try:
                status, body = await asyncio.to_thread(trigger_run, workflow, token, request_id)
                log.info(
                    "triggered request_id=%s status=%s body=%s",
                    request_id, status, body.strip(),
                )
            except Exception:
                # Swallow + log: a runner-side failure shouldn't block the
                # consumer, and the offset has already been committed by
                # aiokafka's auto-commit. Operators see this in the logs.
                log.exception("trigger failed request_id=%s workflow=%s", request_id, workflow)
    finally:
        await consumer.stop()
        if pg_pool is not None:
            await pg_pool.close()


if __name__ == "__main__":
    asyncio.run(consume())

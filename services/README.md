# Async request pipeline (Service A + Kafka + Service B)

Two small services decouple the upstream caller from the WorkflowRunner.
Redpanda (single-node, Kafka-API compatible) is the handoff; Postgres is the
shared store.

```
upstream ─POST /request─▶ request-service ─Kafka(workflow.requests)─▶ listener-service ─POST /hooks/workflow/{file}─▶ workflow-runner
                                  │                                            │                                              │
                                  └── INSERT into `requests`                   └── SELECT webhook_token FROM `workflows`        └── runs in `runs`
```

## Service A — `request_service/` (`:8100`)

```
POST /request
Content-Type: application/json
X-Service-Token: <REQUEST_SERVICE_TOKEN, if set>

{ "workflow": "deploy.yaml", "payload": { ... optional ... } }

→ 200 { "requestId": "req_5f3e…", "status": "queued" }
```

- Mints `requestId`, writes a row to Postgres `requests`, publishes one Kafka
  message to `workflow.requests`, returns synchronously. If the publish
  fails the DB row is rolled back so retries are safe.
- `GET /request/{id}` reads the row back from Postgres.
- `GET /health` reports producer + DB state.
- Auth: set `REQUEST_SERVICE_TOKEN` in the env to require `X-Service-Token`.
  Unset = open. The compose file plumbs this through.

## Service B — `listener_service/` (worker, no HTTP)

- Consumer group `workflow-listener` on topic `workflow.requests`,
  `auto_offset_reset=earliest`.
- On each event: `SELECT content FROM workflows WHERE filename = $1` from the
  shared Postgres database, parses the YAML, extracts `webhook_token`, and
  POSTs to `{WR_BASE_URL}/hooks/workflow/{file}?token=…` with header
  `X-Request-Id: <requestId>` and body `{"request_id": "..."}`.
- Logs the `request_id → run_id` correlation so operators can trace runs back
  to the originating request via `docker compose logs listener-service`.
- A workflow missing `webhook_token` (or absent from the table) is dropped
  with an error log — not a crash — so one bad message can't stall the
  consumer.

## Postgres schema

All three services share the same database. Each ensures its own tables on
boot with `CREATE TABLE IF NOT EXISTS`:

- `accounts(username PK, display_name, role, token_hash, created_at)` — runner
- `workflows(filename PK, content, updated_at)` — runner
- `runs(run_id PK, workflow_file, status, started_at, finished_at, data JSONB)` — runner
- `requests(request_id PK, workflow, status, created_at, payload JSONB)` — Service A

On the runner's first boot against an empty schema, `accounts.json`,
`runs.json`, and `server/workflows/*.yaml` are imported one-shot. After that
the DB is authoritative; on-disk edits are ignored.

## Trying it locally

```bash
# 1. Bring up the stack (postgres, redpanda, runner, A, B).
docker compose up --build -d
docker compose logs workflow-runner | grep -A1 "INITIAL ADMIN"   # capture admin token

# 2. Create a triggerable workflow via the API (UI also works).
#    Pre-API: drop a YAML file into server/workflows/ BEFORE first boot —
#    it'll be picked up by the file→DB migration.
TOKEN=<paste admin token>
curl -s -X POST http://127.0.0.1:8000/workflows/create \
  -H "X-API-Key: $TOKEN" -H 'content-type: application/json' \
  -d '{"filename":"echo.yaml","content":"name: Echo\nwebhook_token: dev-shared-secret\nsteps:\n  - name: hello\n    command: echo hello from the async pipeline\n"}'

# 3. Fire a request. The listener picks it up and triggers a run.
curl -s -X POST http://127.0.0.1:8100/request \
  -H 'content-type: application/json' \
  -d '{"workflow":"echo.yaml"}'
# → {"requestId":"req_…","status":"queued"}

# 4. Watch the correlation land.
docker compose logs -f listener-service
# triggered request_id=req_… status=200 body={"run_id":"r_…"}

# 5. (Optional) Inspect the persisted state.
docker compose exec postgres psql -U workflowrunner -d workflowrunner \
  -c "SELECT request_id, workflow, status FROM requests ORDER BY created_at DESC LIMIT 5;"
```

## Inspecting / poking Kafka

`rpk` ships inside the Redpanda image:

```bash
docker compose exec redpanda rpk topic list
docker compose exec redpanda rpk topic consume workflow.requests
```

The external listener is bound at `127.0.0.1:19092` for host-side `kcat` /
`rpk` use during development. Remove that port mapping for production.

## Notes

- Topic auto-creation is enabled (Redpanda `--mode dev-container`). The first
  produce or consume call creates `workflow.requests`.
- `request_id` is only echoed via header/body to the runner today. If you
  want it persisted on `RunState`, extend `webhook_trigger` in
  `server/main.py` to read `X-Request-Id` and stash it on the run.
- The `POSTGRES_PASSWORD` env var is `changeme` by default. Override in
  `.env` before any deploy past `localhost`.

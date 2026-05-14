# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Backend (from project root):**
- Run dev server: `server/venv/bin/uvicorn server.main:app --port 8000 --reload`
- Install deps: `server/venv/bin/pip install -r server/requirements.txt`

**Frontend (from `client/`):**
- Dev: `pnpm run dev` (reads `VITE_API_URL` from `.env.development`)
- Build: `pnpm run build`
- Lint: `pnpm run lint`

**Docker (single-container prod build):**
- `docker compose up --build` — multi-stage build serves the React app from FastAPI on port 8000. The compose file binds to `127.0.0.1:8000` by default; front it with a TLS-terminating reverse proxy rather than exposing 8000 directly.
- Bind-mounts: `./server/workflows`, `./server/runs.json`, `./server/accounts.json`, `/var/run/docker.sock`, `/srv/compose`. `runs.json` must exist as a file (even just `[]`) before first `docker compose up` — Docker silently creates a *directory* otherwise. The repo ships an empty one.
- Compose sets resource limits (`memory 1g`, `cpus 2.0`), a healthcheck, and JSON-file log rotation (10MB × 5). Drop the docker.sock / /srv/compose mounts if you don't want the homelab workflows touching the host Docker daemon.

**Auth — per-account tokens (no shared secret):**
- On first boot, if `server/accounts.json` is empty, an admin account is seeded and its **plaintext token is printed once to stdout** between `=== WORKFLOW RUNNER · INITIAL ADMIN ===` banner lines. Capture it — it's the only time the plaintext appears.
- Tokens are stored as sha256 hashes; `_token_index` is the in-memory reverse lookup. The middleware hashes the incoming `X-API-Key` (or `?token=` query for SSE) and looks the caller up.
- Env vars: `WR_ADMIN_USERNAME` (default `admin`), `WR_ADMIN_DISPLAY_NAME` (default `Admin`), `WR_ADMIN_TOKEN` (if you want to seed a known token rather than generate one). Also: `WR_STEP_TIMEOUT` (global fallback in seconds, 0/unset = no timeout), `WR_NOTIFY_NTFY_URL`, `WR_NOTIFY_DISCORD_WEBHOOK`, `WR_PUBLIC_BASE_URL` (used in failure-notification run links).
- Roles: `admin` can create/edit/delete workflows + manage accounts; `member` can trigger runs and review. First account is admin.
- Reviewer enforcement: a review step with `reviewers: [usernames]` only releases for someone in that list (returns 403 otherwise). Empty list = anyone signed-in.

No tests exist in this repo.

## Architecture

Full-stack runner that executes user-defined YAML workflows (shell commands + human-review gates) and streams per-step output to the browser via Server-Sent Events.

**Backend (`server/main.py`, single file):**
- FastAPI app + `AsyncIOScheduler` (APScheduler) started in `lifespan`. Every `*.yaml` in `server/workflows/` is scanned at boot; a top-level `schedule:` cron expression registers an automatic job.
- Accounts in-memory: `accounts: dict[username -> account]` + `_token_index: dict[sha256 -> username]`. Persisted to `server/accounts.json`. Helpers `_hash_token`, `_gen_token`, `_make_account`, `save_accounts`, `load_accounts`, `seed_admin_if_empty`.
- Runs live in `runs: dict[str, RunState]`. Terminal runs are persisted to `server/runs.json` (last 200) and reloaded on startup — so History/Dashboard survive restarts, but in-flight runs do not. On load, any `by` / comment `by` referencing a username that no longer exists (or the deprecated demo identities) is collapsed to `"system"` so deleted-account state doesn't haunt the UI.
- `RunState.subscribe()` is the SSE fan-out primitive: it replays buffered `_events`, then attaches an `asyncio.Queue` for live events. Clients reconnecting mid-run see the full stream.
- `execute_workflow()` walks steps in order:
  - **Command step** — shells out via `asyncio.create_subprocess_shell` with `start_new_session=True` (so the process is its own pgroup, killable as a unit). The active proc is stored on `RunState._current_proc` so cancel/timeout can `os.killpg(...)` the whole tree. Each stdout line emits `step_log`. Steps support `timeout:` (seconds); the workflow may set `default_timeout:`; `WR_STEP_TIMEOUT` env is the global fallback. Timeout → step `failed` with `error: "timeout"`.
  - **Review gate** (step has `review: true`) — sets the run to `status: "review"`, emits `review_required`, then awaits `state._review_event`. `POST /workflow/{run_id}/review` with `{decision: "approved"|"rejected", comment, by}` sets the event. Approval continues; rejection fails the run.
- `_notify_failure()` is called after any path that ends `state.status == "failed"`. It POSTs a one-shot title + body to `WR_NOTIFY_NTFY_URL` and/or `WR_NOTIFY_DISCORD_WEBHOOK` via stdlib `urllib` in a worker thread. Notifications are best-effort; exceptions are swallowed. `WR_PUBLIC_BASE_URL` controls the run-link suffix.
- Comments live on `RunState.comments` and are pushed as `comment` SSE events; both review decisions and free-form `POST /workflow/{run_id}/comment` calls land there.

**Workflow YAML schema:**
```yaml
name: <display name>
description: <optional>
schedule: "*/5 * * * *"   # optional cron — auto-registers with scheduler
owner: <team>             # surfaced in UI
tags: [...]               # surfaced in UI
glyph: "DP"               # 2-char monogram for cards/sidebar
steps:
default_timeout: 600        # optional, seconds — fallback for any step without its own timeout
webhook_token: "<secret>"   # optional; if set, POST /hooks/workflow/<file> with ?token=… triggers a run
steps:
  - name: <label>
    command: <shell command>     # run via /bin/sh -c, in its own session
    cwd: <optional working dir>
    timeout: 600                 # optional per-step seconds; overrides default_timeout / WR_STEP_TIMEOUT
  - name: Review gate
    review: true                 # pauses run; UI shows approve/reject panel
    reviewers: [team-name, ...]  # surfaced in inbox + review panel
    prompt: "Confirm before continuing."
```

**API surface (all endpoints require auth; admin-only endpoints are flagged):**
- `GET /me` — current account (`{username, display_name, role}`)
- `GET /accounts` *(admin)* / `POST /accounts` *(admin, returns one-time `token`)* / `DELETE /accounts/{username}` *(admin, refuses self or last admin)* / `POST /accounts/{username}/rotate-token` *(admin or self)*
- `GET /workflows`, `GET /workflow/{file}/content` — all signed-in users
- `PUT /workflow/{file}` / `POST /workflows/create` / `DELETE /workflow/{file}` — *admin only*; `PUT`/`POST` re-sync cron via `sync_schedule()`
- `POST /workflow/run` — server sets `by = current_user.username`; client doesn't send it
- `GET /workflow/{run_id}/stream` — SSE; auth via `?token=` query param (EventSource can't send headers)
- `POST /workflow/{run_id}/review` — `{decision, comment}`; server enforces reviewer membership against the gate's `reviewers` list (403 on mismatch)
- `POST /workflow/{run_id}/comment` — `{text}`; server fills `by`
- `POST /workflow/{run_id}/cancel` — run owner or admin only; also `killpg`s the active subprocess group
- `GET /runs?limit=N&status=...` / `GET /runs/{run_id}` / `GET /stats` — read-only, all signed-in users
- `GET /inbox` — paused-on-review runs **filtered to the caller** (reviewers list empty OR includes me)
- `POST /hooks/workflow/{filename}` — **unauthenticated webhook trigger**. Bypasses the auth middleware (path is not in `API_PREFIXES`). The workflow YAML must contain a `webhook_token:` field, and the caller must pass a matching token via `?token=` or the `X-Webhook-Token` header. `secrets.compare_digest` is used for the comparison. Triggered runs land with `by = "webhook"`.

**Frontend (`client/`, React 19 + Vite + React Compiler, react-router):**
- Layout: sidebar (Dashboard / Workflows / Inbox / History + pinned workflows; admin-only Accounts link in Workspace section) and topbar with crumbs + search.
- Identity: `App.tsx` calls `GET /me` after the login token check; the resulting `Me` object (`{username, display_name, role}`) is plumbed through to pages that need it. There is no hardcoded user.
- Routes: `/` (dashboard), `/workflows`, `/workflows/:file` (detail with Steps/YAML/Runs/Settings tabs), `/runs/:runId` (live run + review panel), `/history`, `/inbox`, `/settings/accounts` (admin only — `AccountsPage` lists/creates/deletes accounts and rotates tokens).
- `hooks/useRunStream.ts` — single owner of the EventSource lifecycle. Hydrates from `GET /runs/{id}` then attaches SSE listeners for `step_start`/`step_log`/`step_done`/`step_failed`/`review_required`/`comment`/`workflow_done` and dispatches into a reducer.
- `hooks/useTweaks.ts` — theme/density/accent persisted to `localStorage`; updates CSS custom properties on `<html>`. ⌘. toggles the floating Tweaks panel.
- `components/YamlEditor.tsx` — CodeMirror 6 with YAML + oneDark; emits the doc string to the workflow detail page, which PUTs back on Save.
- `config.ts`: `apiFetch` adds `X-API-Key`; `apiSSE` uses `?token=` query param because the `EventSource` API can't send custom headers. Token stored in `localStorage` as `wr_token`.
- `styles.css` is a ported design-system stylesheet (oklch tokens, dark/light/density variants); avoid inlining colors — use the CSS variables (`--accent`, `--review`, `--success`, `--danger`, `--surface*`).

**SSE event types** (emitted by backend, consumed by `useRunStream`):
`workflow_start`, `step_start`, `step_log`, `step_done`, `step_failed`, `review_required`, `comment`, `workflow_done`.

## Conventions

- New workflows: drop a YAML file in `server/workflows/`. Ad-hoc runs read fresh on every request. **Newly added scheduled workflows need a backend restart unless created via the API** — `load_schedules()` only runs at startup; `sync_schedule()` runs on `PUT`/`POST` of YAML through the API.
- The token printed on first boot is the only chance to capture the seeded admin token. If you lose it, delete `server/accounts.json` and restart to re-seed (this also wipes all other accounts).
- The `by` field on runs and comments is a **username** (validated against `accounts`) plus three sentinels: `"scheduler"` (cron-triggered), `"webhook"` (hooks-triggered), and `"system"` (stale identity post-account-deletion). Server fills it from the session — clients never send it.
- Backend is intentionally a single file. Resist splitting it up unless adding substantial new surface area.
- Commands run unsandboxed. Don't add workflows that pull from untrusted YAML, and don't shell out to user input from the API surface.

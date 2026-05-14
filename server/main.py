from __future__ import annotations

import asyncio
import datetime
import hashlib
import json
import os
import re
import secrets
import signal
import time
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional
from uuid import uuid4

import yaml
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

WORKFLOWS_DIR = Path(__file__).parent / "workflows"
CLIENT_DIST = Path(__file__).parent.parent / "client" / "dist"
RUNS_FILE = Path(__file__).parent / "runs.json"
ACCOUNTS_FILE = Path(__file__).parent / "accounts.json"

USERNAME_RE = re.compile(r"^[a-z0-9_-]{2,32}$")
ROLES = {"admin", "member"}
SCHEDULER_USER = "scheduler"
WEBHOOK_USER = "webhook"

# Optional global default if a step doesn't set its own timeout. 0/unset = no limit.
try:
    DEFAULT_STEP_TIMEOUT = int(os.environ.get("WR_STEP_TIMEOUT", "0")) or None
except ValueError:
    DEFAULT_STEP_TIMEOUT = None

# Failure notification sinks. Either, both, or neither may be set.
NTFY_URL = os.environ.get("WR_NOTIFY_NTFY_URL", "").strip()
DISCORD_WEBHOOK = os.environ.get("WR_NOTIFY_DISCORD_WEBHOOK", "").strip()
PUBLIC_BASE_URL = os.environ.get("WR_PUBLIC_BASE_URL", "").strip().rstrip("/")

# ── In-memory state ───────────────────────────────────────────────────────────

runs: dict[str, "RunState"] = {}
scheduler = AsyncIOScheduler()

# username -> {username, display_name, role, token_hash, created_at}
accounts: dict[str, dict] = {}
# sha256(token) -> username
_token_index: dict[str, str] = {}


# ── Account helpers ──────────────────────────────────────────────────────────

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _gen_token() -> str:
    return secrets.token_urlsafe(32)


def _public_account(acct: dict) -> dict:
    return {
        "username": acct["username"],
        "display_name": acct["display_name"],
        "role": acct["role"],
        "created_at": acct["created_at"],
    }


def _make_account(username: str, display_name: str, role: str, token: str) -> dict:
    return {
        "username": username,
        "display_name": display_name,
        "role": role,
        "token_hash": _hash_token(token),
        "created_at": now_iso(),
    }


def save_accounts() -> None:
    try:
        ACCOUNTS_FILE.write_text(json.dumps(list(accounts.values()), indent=2))
    except Exception:
        pass


def load_accounts() -> None:
    accounts.clear()
    _token_index.clear()
    if not ACCOUNTS_FILE.exists():
        return
    try:
        data = json.loads(ACCOUNTS_FILE.read_text())
    except Exception:
        return
    for entry in data:
        if not isinstance(entry, dict) or "username" not in entry:
            continue
        accounts[entry["username"]] = entry
        if entry.get("token_hash"):
            _token_index[entry["token_hash"]] = entry["username"]


def _register_token(username: str, token: str) -> None:
    acct = accounts[username]
    old = acct.get("token_hash")
    if old and _token_index.get(old) == username:
        _token_index.pop(old, None)
    acct["token_hash"] = _hash_token(token)
    _token_index[acct["token_hash"]] = username


def seed_admin_if_empty() -> None:
    if accounts:
        return
    username = os.environ.get("WR_ADMIN_USERNAME", "admin").strip().lower() or "admin"
    if not USERNAME_RE.match(username):
        username = "admin"
    display_name = os.environ.get("WR_ADMIN_DISPLAY_NAME") or username.title()
    token = os.environ.get("WR_ADMIN_TOKEN") or _gen_token()
    acct = _make_account(username, display_name, "admin", token)
    accounts[username] = acct
    _token_index[acct["token_hash"]] = username
    save_accounts()
    banner = "=" * 38
    print(f"\n{banner}")
    print(" WORKFLOW RUNNER · INITIAL ADMIN")
    print(banner)
    print(f"  username:     {username}")
    print(f"  display_name: {display_name}")
    print(f"  token:        {token}")
    print(f"{banner}")
    print(" Use this token to sign in. Rotate from the Accounts page.\n", flush=True)


def now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


class RunState:
    def __init__(self, workflow: dict, filename: str, by: str = "manual"):
        self.run_id = "r_" + uuid4().hex[:6]
        self.workflow = workflow
        self.workflow_file = filename
        self.by = by
        self.status = "pending"
        self.steps: list[dict] = [
            {
                "name": s["name"],
                "status": "pending",
                "duration_ms": None,
                "started_at": None,
                "review": bool(s.get("review")),
                "command": s.get("command"),
                "prompt": s.get("prompt"),
                "reviewers": s.get("reviewers", []),
            }
            for s in workflow["steps"]
        ]
        self._events: list[dict] = []
        self._queues: list[asyncio.Queue] = []
        self._review_event = asyncio.Event()
        self._review_decision: str | None = None
        self._review_comment: str = ""
        self._review_by: str | None = None
        self.comments: list[dict] = []
        self.started_at = now_iso()
        self.finished_at: str | None = None
        self.duration_ms: int | None = None
        self._current_proc: asyncio.subprocess.Process | None = None

    def emit(self, event_type: str, data: dict) -> None:
        event = {"type": event_type, "data": data}
        self._events.append(event)
        for q in self._queues:
            q.put_nowait(event)

    @property
    def logs(self) -> list[dict]:
        return [e["data"] for e in self._events if e["type"] == "step_log"]

    @property
    def is_terminal(self) -> bool:
        return self.status in ("done", "failed", "cancelled")

    async def subscribe(self):
        for event in list(self._events):
            yield event
        if self.is_terminal:
            return
        q: asyncio.Queue = asyncio.Queue()
        self._queues.append(q)
        try:
            while True:
                event = await q.get()
                yield event
                if event["type"] == "workflow_done":
                    break
        finally:
            if q in self._queues:
                self._queues.remove(q)

    def to_summary(self) -> dict:
        progress = []
        for s in self.steps:
            if s["status"] == "done":
                progress.append(1)
            elif s["status"] == "review" or s["status"] == "awaiting":
                progress.append(2)
            elif s["status"] == "failed":
                progress.append(3)
            elif s["status"] == "running":
                progress.append(4)
            else:
                progress.append(0)
        return {
            "run_id": self.run_id,
            "workflow_name": self.workflow.get("name", self.workflow_file),
            "workflow_file": self.workflow_file,
            "status": self.status,
            "by": self.by,
            "steps": self.steps,
            "progress": progress,
            "logs": self.logs,
            "comments": self.comments,
            "duration_ms": self.duration_ms,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


# ── Persistence ───────────────────────────────────────────────────────────────

def save_runs() -> None:
    payload = [r.to_summary() for r in runs.values() if r.is_terminal]
    # Keep the 200 most recent terminal runs
    payload = payload[-200:]
    try:
        RUNS_FILE.write_text(json.dumps(payload, indent=2))
    except Exception:
        pass


def load_runs() -> None:
    if not RUNS_FILE.exists():
        return
    try:
        data = json.loads(RUNS_FILE.read_text())
    except Exception:
        return
    dirty = False
    known = set(accounts.keys()) | {SCHEDULER_USER, WEBHOOK_USER}
    for entry in data:
        wf = {"name": entry.get("workflow_name"), "steps": entry.get("steps", [])}
        state = RunState.__new__(RunState)
        state.run_id = entry["run_id"]
        state.workflow = wf
        state.workflow_file = entry.get("workflow_file", "")
        raw_by = entry.get("by", "manual")
        # Anything that isn't a known account (or the scheduler sentinel) collapses
        # to the generic 'system' bucket so stale identities don't keep
        # appearing in the UI after an account is deleted.
        if raw_by not in known:
            state.by = "system"
            dirty = True
        else:
            state.by = raw_by
        state.status = entry["status"]
        state.steps = entry.get("steps", [])
        state._events = []
        state._queues = []
        state._review_event = asyncio.Event()
        state._review_decision = None
        state._review_comment = ""
        state._review_by = None
        scrubbed_comments = []
        for c in entry.get("comments", []) or []:
            if c.get("by") in known:
                scrubbed_comments.append(c)
            else:
                dirty = True
        state.comments = scrubbed_comments
        state.started_at = entry.get("started_at", now_iso())
        state.finished_at = entry.get("finished_at")
        state.duration_ms = entry.get("duration_ms")
        state._current_proc = None
        # synthesise log events so the SSE replay endpoint still works
        for log in entry.get("logs", []):
            state._events.append({"type": "step_log", "data": log})
        runs[state.run_id] = state
    if dirty:
        save_runs()


# ── Process + notification helpers ────────────────────────────────────────────

def _kill_process_group(proc: asyncio.subprocess.Process | None) -> None:
    """Best-effort SIGTERM to the entire process group of a still-running child.
    Safe to call on a finished or None proc."""
    if proc is None or proc.returncode is not None:
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError, OSError):
        pass


def _post_notifications(title: str, body: str) -> None:
    """Blocking notification dispatcher — call via asyncio.to_thread.
    Failures are swallowed; notifications are best-effort."""
    ascii_title = title.encode("ascii", "replace").decode("ascii")
    if NTFY_URL:
        try:
            req = urllib.request.Request(
                NTFY_URL,
                data=body.encode("utf-8"),
                headers={"Title": ascii_title, "Priority": "high", "Tags": "warning"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=5).read()
        except Exception:
            pass
    if DISCORD_WEBHOOK:
        try:
            payload = json.dumps(
                {"content": f"**{title}**\n```\n{body}\n```"}
            ).encode("utf-8")
            req = urllib.request.Request(
                DISCORD_WEBHOOK,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=5).read()
        except Exception:
            pass


async def _notify_failure(state: "RunState") -> None:
    if state.status != "failed":
        return
    if not (NTFY_URL or DISCORD_WEBHOOK):
        return
    name = state.workflow.get("name", state.workflow_file)
    failed_step = next(
        (s["name"] for s in state.steps if s.get("status") == "failed"),
        "(unknown step)",
    )
    link = (
        f"{PUBLIC_BASE_URL}/runs/{state.run_id}"
        if PUBLIC_BASE_URL
        else f"run {state.run_id}"
    )
    title = f"Workflow failed: {name}"
    body = (
        f"Step: {failed_step}\n"
        f"Triggered by: {state.by}\n"
        f"Run: {link}"
    )
    await asyncio.to_thread(_post_notifications, title, body)


# ── Scheduling helpers ────────────────────────────────────────────────────────

def load_schedules() -> None:
    if not WORKFLOWS_DIR.exists():
        return
    for f in WORKFLOWS_DIR.glob("*.yaml"):
        try:
            with open(f) as fp:
                wf = yaml.safe_load(fp)
            if wf and wf.get("schedule"):
                scheduler.add_job(
                    run_workflow_by_file,
                    CronTrigger.from_crontab(wf["schedule"]),
                    id=f.name,
                    replace_existing=True,
                    kwargs={"filename": f.name, "by": "scheduler"},
                )
        except Exception:
            pass


def sync_schedule(filename: str, wf: dict) -> None:
    try:
        if wf.get("schedule"):
            scheduler.add_job(
                run_workflow_by_file,
                CronTrigger.from_crontab(wf["schedule"]),
                id=filename,
                replace_existing=True,
                kwargs={"filename": filename, "by": "scheduler"},
            )
        else:
            try:
                scheduler.remove_job(filename)
            except Exception:
                pass
    except Exception:
        pass


async def run_workflow_by_file(filename: str, by: str = "scheduler") -> None:
    path = (WORKFLOWS_DIR / filename).resolve()
    if not path.exists():
        return
    with open(path) as f:
        workflow = yaml.safe_load(f)
    state = RunState(workflow, filename, by=by)
    runs[state.run_id] = state
    await execute_workflow(state)


# ── App lifecycle ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_accounts()
    seed_admin_if_empty()
    load_runs()
    load_schedules()
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Workflow Runner", lifespan=lifespan)


# ── Auth middleware ───────────────────────────────────────────────────────────

API_PREFIXES = ("/workflow", "/workflows", "/runs", "/stats", "/inbox", "/me", "/accounts")


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)
        path = request.url.path
        if not any(path == p or path.startswith(p + "/") or path == p for p in API_PREFIXES):
            return await call_next(request)
        token = request.headers.get("X-API-Key") or request.query_params.get("token")
        username = _token_index.get(_hash_token(token)) if token else None
        user = accounts.get(username) if username else None
        if not user:
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        request.state.user = user
        return await call_next(request)


def current_user(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "Unauthorized")
    return user


def require_admin(request: Request) -> dict:
    user = current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin required")
    return user


app.add_middleware(AuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Workflow file endpoints ───────────────────────────────────────────────────

def workflow_stats(filename: str) -> dict:
    """Compute success-rate, runs in last 7d, last run summary for a workflow."""
    week_ago = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=7)
    relevant = [r for r in runs.values() if r.workflow_file == filename]
    runs_7d = 0
    successes = 0
    failures = 0
    durations: list[int] = []
    for r in relevant:
        try:
            started = datetime.datetime.fromisoformat(r.started_at)
        except Exception:
            continue
        if started > week_ago:
            runs_7d += 1
        if r.status == "done":
            successes += 1
            if r.duration_ms:
                durations.append(r.duration_ms)
        elif r.status == "failed":
            failures += 1
    total = successes + failures
    success_rate = round((successes / total) * 100) if total else 100
    last_run = None
    if relevant:
        last = max(relevant, key=lambda r: r.started_at)
        last_run = {
            "run_id": last.run_id,
            "status": last.status,
            "duration_ms": last.duration_ms,
            "started_at": last.started_at,
            "by": last.by,
        }
    return {
        "success_rate": success_rate,
        "runs_7d": runs_7d,
        "last_run": last_run,
    }


# ── Identity + account endpoints ──────────────────────────────────────────────

@app.get("/me")
def get_me(user: dict = Depends(current_user)):
    return {
        "username": user["username"],
        "display_name": user["display_name"],
        "role": user["role"],
    }


@app.get("/accounts")
def list_accounts(_admin: dict = Depends(require_admin)):
    return [_public_account(a) for a in sorted(accounts.values(), key=lambda x: x["created_at"])]


class CreateAccountRequest(BaseModel):
    username: str
    display_name: str
    role: str = "member"


@app.post("/accounts")
def create_account(body: CreateAccountRequest, _admin: dict = Depends(require_admin)):
    username = body.username.strip().lower()
    if not USERNAME_RE.match(username):
        raise HTTPException(422, "username must be 2-32 chars, [a-z0-9_-]")
    if body.role not in ROLES:
        raise HTTPException(422, f"role must be one of {sorted(ROLES)}")
    if username == SCHEDULER_USER:
        raise HTTPException(422, f"'{SCHEDULER_USER}' is reserved")
    if username in accounts:
        raise HTTPException(409, f"username '{username}' already exists")
    display_name = body.display_name.strip() or username
    token = _gen_token()
    acct = _make_account(username, display_name, body.role, token)
    accounts[username] = acct
    _token_index[acct["token_hash"]] = username
    save_accounts()
    return {**_public_account(acct), "token": token}


@app.delete("/accounts/{username}")
def delete_account(username: str, admin: dict = Depends(require_admin)):
    if username not in accounts:
        raise HTTPException(404, "Account not found")
    if username == admin["username"]:
        raise HTTPException(409, "Cannot delete yourself")
    if accounts[username]["role"] == "admin":
        remaining_admins = sum(
            1 for u, a in accounts.items() if a["role"] == "admin" and u != username
        )
        if remaining_admins == 0:
            raise HTTPException(409, "Cannot delete the last admin")
    acct = accounts.pop(username)
    _token_index.pop(acct.get("token_hash", ""), None)
    save_accounts()
    return {"ok": True}


@app.post("/accounts/{username}/rotate-token")
def rotate_account_token(username: str, request: Request):
    user = current_user(request)
    if user["username"] != username and user["role"] != "admin":
        raise HTTPException(403, "Only admins or the account owner can rotate this token")
    if username not in accounts:
        raise HTTPException(404, "Account not found")
    token = _gen_token()
    _register_token(username, token)
    save_accounts()
    return {"username": username, "token": token}


# ── Workflow file endpoints ───────────────────────────────────────────────────

@app.get("/workflows")
def get_workflows(_user: dict = Depends(current_user)):
    result = []
    if WORKFLOWS_DIR.exists():
        for f in sorted(WORKFLOWS_DIR.glob("*.yaml")):
            with open(f) as fp:
                wf = yaml.safe_load(fp)
            if not wf:
                continue
            wf["_file"] = f.name
            job = scheduler.get_job(f.name)
            if job and job.next_run_time:
                wf["next_run"] = job.next_run_time.isoformat()
            wf["stats"] = workflow_stats(f.name)
            result.append(wf)
    return result


class WorkflowContent(BaseModel):
    content: str


@app.get("/workflow/{filename}/content")
def get_workflow_content(filename: str, _user: dict = Depends(current_user)):
    path = (WORKFLOWS_DIR / filename).resolve()
    if not path.is_relative_to(WORKFLOWS_DIR.resolve()) or not path.exists():
        raise HTTPException(404, "Workflow not found")
    return {"content": path.read_text()}


@app.put("/workflow/{filename}")
def update_workflow(filename: str, body: WorkflowContent, _admin: dict = Depends(require_admin)):
    path = (WORKFLOWS_DIR / filename).resolve()
    if not path.is_relative_to(WORKFLOWS_DIR.resolve()) or not path.exists():
        raise HTTPException(404, "Workflow not found")
    try:
        wf = yaml.safe_load(body.content)
    except yaml.YAMLError as e:
        raise HTTPException(422, f"Invalid YAML: {e}")
    path.write_text(body.content)
    sync_schedule(filename, wf or {})
    return {"ok": True}


@app.delete("/workflow/{filename}")
def delete_workflow(filename: str, _admin: dict = Depends(require_admin)):
    path = (WORKFLOWS_DIR / filename).resolve()
    if not path.is_relative_to(WORKFLOWS_DIR.resolve()) or not path.exists():
        raise HTTPException(404, "Workflow not found")
    try:
        scheduler.remove_job(filename)
    except Exception:
        pass
    path.unlink()
    return {"ok": True}


class CreateRequest(BaseModel):
    filename: str
    content: str


@app.post("/workflows/create")
def create_workflow(body: CreateRequest, _admin: dict = Depends(require_admin)):
    if "/" in body.filename or "\\" in body.filename or not body.filename.endswith(".yaml"):
        raise HTTPException(400, "Filename must be a plain .yaml filename with no path separators")
    path = (WORKFLOWS_DIR / body.filename).resolve()
    if not path.is_relative_to(WORKFLOWS_DIR.resolve()):
        raise HTTPException(400, "Invalid path")
    if path.exists():
        raise HTTPException(409, f"'{body.filename}' already exists")
    try:
        wf = yaml.safe_load(body.content)
    except yaml.YAMLError as e:
        raise HTTPException(422, f"Invalid YAML: {e}")
    path.write_text(body.content)
    sync_schedule(body.filename, wf or {})
    return {"ok": True, "_file": body.filename}


# ── Run endpoints ─────────────────────────────────────────────────────────────

class RunRequest(BaseModel):
    workflow_file: str


@app.post("/workflow/run")
async def start_run(
    req: RunRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(current_user),
):
    path = (WORKFLOWS_DIR / req.workflow_file).resolve()
    if not path.is_relative_to(WORKFLOWS_DIR.resolve()) or not path.exists():
        raise HTTPException(404, "Workflow not found")
    with open(path) as f:
        workflow = yaml.safe_load(f)
    state = RunState(workflow, req.workflow_file, by=user["username"])
    runs[state.run_id] = state
    background_tasks.add_task(execute_workflow, state)
    return {"run_id": state.run_id}


async def execute_workflow(state: RunState) -> None:
    state.status = "running"
    workflow_start = time.monotonic()
    state.emit("workflow_start", {
        "workflow_name": state.workflow["name"],
        "total_steps": len(state.workflow["steps"]),
    })

    async def finalize_failure() -> None:
        state.status = "failed"
        total = int((time.monotonic() - workflow_start) * 1000)
        state.duration_ms = total
        state.finished_at = now_iso()
        state.emit("workflow_done", {"status": "failed", "duration_ms": total})
        save_runs()
        await _notify_failure(state)

    default_timeout = state.workflow.get("default_timeout") or DEFAULT_STEP_TIMEOUT

    for i, step in enumerate(state.workflow["steps"]):
        # If something cancelled us between steps, stop cleanly.
        if state.status == "cancelled":
            return

        step_start = time.monotonic()
        state.steps[i]["started_at"] = now_iso()

        # ── Human-review gate ───────────────────────────────────────────────
        if step.get("review"):
            state.steps[i]["status"] = "awaiting"
            state.status = "review"
            state.emit("step_start", {"step_index": i, "step_name": step["name"], "review": True})
            state.emit("review_required", {
                "step_index": i,
                "step_name": step["name"],
                "prompt": step.get("prompt", ""),
                "reviewers": step.get("reviewers", []),
            })

            await state._review_event.wait()
            state._review_event.clear()

            # Cancellation finalizes the run itself — don't double-emit.
            if state.status == "cancelled":
                return

            decision = state._review_decision
            duration = int((time.monotonic() - step_start) * 1000)
            state.steps[i]["duration_ms"] = duration

            if decision == "approved":
                state.steps[i]["status"] = "done"
                state.status = "running"
                state.emit("step_done", {
                    "step_index": i,
                    "duration_ms": duration,
                    "decision": "approved",
                    "by": state._review_by,
                })
                state._review_decision = None
                state._review_by = None
                continue
            else:
                state.steps[i]["status"] = "failed"
                state.emit("step_failed", {
                    "step_index": i,
                    "duration_ms": duration,
                    "decision": "rejected",
                    "by": state._review_by,
                })
                await finalize_failure()
                return

        # ── Regular command step ────────────────────────────────────────────
        state.steps[i]["status"] = "running"
        state.emit("step_start", {"step_index": i, "step_name": step["name"]})

        timeout = step.get("timeout") or default_timeout
        proc: asyncio.subprocess.Process | None = None
        try:
            proc = await asyncio.create_subprocess_shell(
                step["command"],
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=step.get("cwd"),
                start_new_session=True,
            )
            state._current_proc = proc

            async def _drain(p: asyncio.subprocess.Process = proc) -> None:
                async for raw in p.stdout:
                    line = raw.decode(errors="replace").rstrip()
                    state.emit("step_log", {
                        "step_index": i, "step_name": step["name"], "line": line,
                    })
                await p.wait()

            if timeout:
                await asyncio.wait_for(_drain(), timeout=float(timeout))
            else:
                await _drain()
        except asyncio.TimeoutError:
            _kill_process_group(proc)
            try:
                if proc is not None:
                    await asyncio.wait_for(proc.wait(), timeout=5)
            except (asyncio.TimeoutError, Exception):
                pass
            state.emit("step_log", {
                "step_index": i, "step_name": step["name"],
                "line": f"[timeout after {timeout}s — process killed]",
            })
            duration = int((time.monotonic() - step_start) * 1000)
            state.steps[i]["duration_ms"] = duration
            state.steps[i]["status"] = "failed"
            state.emit("step_failed", {
                "step_index": i, "error": "timeout",
                "timeout_s": timeout, "duration_ms": duration,
            })
            state._current_proc = None
            await finalize_failure()
            return
        except Exception as exc:
            _kill_process_group(proc)
            state.steps[i]["status"] = "failed"
            state.emit("step_failed", {"step_index": i, "error": str(exc)})
            state._current_proc = None
            await finalize_failure()
            return
        finally:
            state._current_proc = None

        # Cancellation may have killed the subprocess mid-step; if so, the
        # cancel handler already finalized the run — just bail.
        if state.status == "cancelled":
            return

        duration = int((time.monotonic() - step_start) * 1000)
        state.steps[i]["duration_ms"] = duration
        if proc.returncode == 0:
            state.steps[i]["status"] = "done"
            state.emit("step_done", {"step_index": i, "duration_ms": duration})
        else:
            state.steps[i]["status"] = "failed"
            state.emit("step_failed", {
                "step_index": i,
                "exit_code": proc.returncode,
                "duration_ms": duration,
            })
            await finalize_failure()
            return

    state.status = "done"
    total = int((time.monotonic() - workflow_start) * 1000)
    state.duration_ms = total
    state.finished_at = now_iso()
    state.emit("workflow_done", {"status": "success", "duration_ms": total})
    save_runs()


@app.get("/workflow/{run_id}/stream")
async def stream_run(run_id: str):
    if run_id not in runs:
        raise HTTPException(404, "Run not found")
    state = runs[run_id]

    async def generator():
        async for event in state.subscribe():
            yield {"event": event["type"], "data": json.dumps(event["data"])}

    return EventSourceResponse(generator())


class ReviewDecision(BaseModel):
    decision: str  # "approved" | "rejected"
    comment: Optional[str] = ""


@app.post("/workflow/{run_id}/review")
async def post_review(run_id: str, body: ReviewDecision, user: dict = Depends(current_user)):
    if run_id not in runs:
        raise HTTPException(404, "Run not found")
    if body.decision not in ("approved", "rejected"):
        raise HTTPException(422, "decision must be 'approved' or 'rejected'")
    state = runs[run_id]
    if state.status != "review":
        raise HTTPException(409, "Run is not awaiting review")
    gate = next(
        (s for s in state.steps if s["status"] == "awaiting"),
        None,
    )
    reviewers = (gate or {}).get("reviewers") or []
    if reviewers and user["username"] not in reviewers:
        raise HTTPException(
            403,
            f"Reviewer required: this gate is restricted to {reviewers}",
        )
    state._review_decision = body.decision
    state._review_comment = body.comment or ""
    state._review_by = user["username"]
    if body.comment:
        comment = {
            "by": user["username"],
            "text": body.comment,
            "at": now_iso(),
            "decision": body.decision,
        }
        state.comments.append(comment)
        state.emit("comment", comment)
    state._review_event.set()
    return {"ok": True}


class CommentBody(BaseModel):
    text: str


@app.post("/workflow/{run_id}/comment")
async def post_comment(run_id: str, body: CommentBody, user: dict = Depends(current_user)):
    if run_id not in runs:
        raise HTTPException(404, "Run not found")
    state = runs[run_id]
    comment = {
        "by": user["username"],
        "text": body.text,
        "at": now_iso(),
        "decision": None,
    }
    state.comments.append(comment)
    state.emit("comment", comment)
    return {"ok": True, "comment": comment}


@app.post("/workflow/{run_id}/cancel")
async def cancel_run(run_id: str, user: dict = Depends(current_user)):
    if run_id not in runs:
        raise HTTPException(404, "Run not found")
    state = runs[run_id]
    if state.is_terminal:
        return {"ok": True}
    if user["role"] != "admin" and state.by != user["username"]:
        raise HTTPException(403, "Only the run's owner or an admin can cancel")
    state.status = "cancelled"
    state.finished_at = now_iso()
    # Kill any in-flight subprocess (process group, so children die too).
    _kill_process_group(getattr(state, "_current_proc", None))
    # Unblock a paused review gate, if that's where the run was.
    state._review_decision = "rejected"
    state._review_by = user["username"]
    state._review_event.set()
    state.emit("workflow_done", {"status": "cancelled", "duration_ms": state.duration_ms or 0})
    save_runs()
    return {"ok": True}


@app.get("/runs")
def list_runs(
    limit: int = 100,
    status: Optional[str] = None,
    _user: dict = Depends(current_user),
):
    items = list(runs.values())
    items.sort(key=lambda r: r.started_at, reverse=True)
    if status:
        items = [r for r in items if r.status == status]
    return [r.to_summary() for r in items[:limit]]


@app.get("/runs/{run_id}")
def get_run(run_id: str, _user: dict = Depends(current_user)):
    if run_id not in runs:
        raise HTTPException(404, "Run not found")
    return runs[run_id].to_summary()


# ── Aggregations ──────────────────────────────────────────────────────────────

@app.get("/stats")
def get_stats(_user: dict = Depends(current_user)):
    week_ago = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=7)
    prev_week = week_ago - datetime.timedelta(days=7)
    runs_7d = 0
    runs_prev = 0
    successes = 0
    failures = 0
    durations: list[int] = []
    for r in runs.values():
        try:
            started = datetime.datetime.fromisoformat(r.started_at)
        except Exception:
            continue
        if started > week_ago:
            runs_7d += 1
            if r.status == "done":
                successes += 1
                if r.duration_ms:
                    durations.append(r.duration_ms)
            elif r.status == "failed":
                failures += 1
        elif started > prev_week:
            runs_prev += 1

    total = successes + failures
    success_rate = round((successes / total) * 100, 1) if total else 100.0
    avg_ms = int(sum(durations) / len(durations)) if durations else 0
    pending_reviews = sum(1 for r in runs.values() if r.status == "review")

    delta_pct = 0
    if runs_prev:
        delta_pct = round(((runs_7d - runs_prev) / runs_prev) * 100)

    return {
        "runs_7d": runs_7d,
        "runs_7d_delta_pct": delta_pct,
        "success_rate": success_rate,
        "avg_duration_ms": avg_ms,
        "pending_reviews": pending_reviews,
    }


@app.get("/inbox")
def get_inbox(user: dict = Depends(current_user)):
    """Runs paused on a review step, filtered to those the caller can act on."""
    out = []
    for r in runs.values():
        if r.status != "review":
            continue
        gate_idx = next(
            (i for i, s in enumerate(r.steps) if s["status"] == "awaiting"),
            None,
        )
        gate = (
            r.workflow.get("steps", [{}])[gate_idx]
            if gate_idx is not None and gate_idx < len(r.workflow.get("steps", []))
            else {}
        )
        reviewers = gate.get("reviewers", []) or []
        if reviewers and user["username"] not in reviewers:
            continue
        out.append({
            "run_id": r.run_id,
            "workflow_name": r.workflow.get("name"),
            "workflow_file": r.workflow_file,
            "step_index": gate_idx,
            "step_name": gate.get("name"),
            "reviewers": reviewers,
            "prompt": gate.get("prompt", ""),
            "by": r.by,
            "started_at": r.started_at,
        })
    out.sort(key=lambda x: x["started_at"], reverse=True)
    return out


# ── Webhook trigger (unauthenticated; per-workflow shared secret) ────────────

@app.post("/hooks/workflow/{filename}")
async def webhook_trigger(
    filename: str,
    request: Request,
    background_tasks: BackgroundTasks,
):
    """External-trigger endpoint. Bypasses normal auth; instead, the caller
    must supply a token that matches the workflow's `webhook_token:` field.
    Token can come from `?token=` or the `X-Webhook-Token` header."""
    path = (WORKFLOWS_DIR / filename).resolve()
    if not path.is_relative_to(WORKFLOWS_DIR.resolve()) or not path.exists():
        raise HTTPException(404, "Workflow not found")
    with open(path) as f:
        workflow = yaml.safe_load(f) or {}
    expected = workflow.get("webhook_token")
    if not expected:
        raise HTTPException(404, "Workflow does not accept webhooks")
    supplied = (
        request.query_params.get("token")
        or request.headers.get("X-Webhook-Token")
        or ""
    )
    if not secrets.compare_digest(str(expected), str(supplied)):
        raise HTTPException(401, "Invalid webhook token")
    state = RunState(workflow, filename, by=WEBHOOK_USER)
    runs[state.run_id] = state
    background_tasks.add_task(execute_workflow, state)
    return {"run_id": state.run_id}


# ── SPA static file serving (production) ─────────────────────────────────────

if CLIENT_DIST.exists():
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = CLIENT_DIST / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(CLIENT_DIST / "index.html")

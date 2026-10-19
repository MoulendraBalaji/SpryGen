from __future__ import annotations
import hmac
import json
import os
import secrets
from contextlib import asynccontextmanager
from typing import Any
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from .config import SERVER_HOST, SERVER_PORT
from .agents.orchestrator import Orchestrator
from .services.automation import automation


orchestrator = Orchestrator()
ws_clients: list[WebSocket] = []

# Per-launch shared secret supplied by Electron. If it is missing we generate
# one so the trust boundary is never silently disabled.
TOKEN = os.getenv("SPRYGEN_TOKEN", "")
if not TOKEN:
    TOKEN = secrets.token_urlsafe(24)
    print(f"[SPRYGEN Python Backend] SPRYGEN_TOKEN not set; generated: {TOKEN}")

ALLOWED_HOSTS = {
    f"{SERVER_HOST}:{SERVER_PORT}",
    f"127.0.0.1:{SERVER_PORT}",
    f"localhost:{SERVER_PORT}",
    "127.0.0.1",
    "localhost",
}



class ChatRequest(BaseModel):
    """Stateless chat request.

    The Electron main process owns all persistence and passes the context the
    stateless agents need to answer: recent history, the profile, and the
    current tasks/facts/assignments.
    """

    text: str
    history: list[dict[str, Any]] = []
    profile: dict[str, Any] = {}
    tasks: list[dict[str, Any]] = []
    facts: list[dict[str, Any]] = []
    assignments: list[dict[str, Any]] = []


class ScrapeRequest(BaseModel):
    url: str
    selector: str | None = None
    headless: bool = True


class BrowserTaskRequest(BaseModel):
    steps: list[dict[str, Any]]
    headless: bool = True


class DesktopActionRequest(BaseModel):
    command: str
    params: dict[str, Any] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[SPRYGEN Python Backend] Starting on {SERVER_HOST}:{SERVER_PORT}")
    yield
    print("[SPRYGEN Python Backend] Shutting down")


def _valid_token(header: str | None) -> bool:
    """Constant-time check of the per-launch bearer token."""
    if not header:
        return False
    expected = f"Bearer {TOKEN}"
    return hmac.compare_digest(header.encode("utf-8"), expected.encode("utf-8"))


def _valid_host(header: str | None) -> bool:
    """Only accept the loopback host(s) this process actually binds."""
    return bool(header) and header in ALLOWED_HOSTS


def _trusted(headers) -> bool:
    """A request is trusted only if it carries no Origin, a known Host, and the token.

    The renderer never talks to Python directly: the Electron main process owns
    the token and proxies every call. Browser-originated requests always send an
    Origin header, so rejecting them closes the CORS/drive-by attack surface.
    """
    return (
        headers.get("origin") is None
        and _valid_host(headers.get("host"))
        and _valid_token(headers.get("authorization"))
    )


app = FastAPI(title="SPRYGEN Multi-Agent Backend", version="3.0.0", lifespan=lifespan)


@app.middleware("http")
async def trust_boundary(request: Request, call_next):
    if request.headers.get("origin") is not None:
        return JSONResponse(
            status_code=403,
            content={"ok": False, "code": "forbidden_origin", "message": "Cross-origin requests are not permitted"},
        )
    if not _valid_host(request.headers.get("host")):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "code": "bad_host", "message": "Unexpected Host header"},
        )
    if not _valid_token(request.headers.get("authorization")):
        return JSONResponse(
            status_code=401,
            content={"ok": False, "code": "unauthorized", "message": "Missing or invalid token"},
        )
    return await call_next(request)


@app.get("/health")
async def health():
    agents = [a.name for a in orchestrator.coordinator._agent_registry.values()]
    return {"status": "ok", "agents": agents}


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Stateless routing + chat.

    Returns ``{answer, intent, actions}``. Electron applies the actions exactly
    once; this endpoint never writes to a datastore.
    """
    return await orchestrator.route(
        req.text,
        req.history,
        req.profile,
        req.tasks,
        req.facts,
        req.assignments,
    )


# ---------------------------------------------------------------------------
# Automation API — Selenium / BeautifulSoup / PyAutoGUI workflows
# ---------------------------------------------------------------------------
@app.get("/api/automation/status")
async def automation_status():
    return automation.status()


@app.post("/api/automation/abort")
async def automation_abort():
    automation.request_abort()
    return {"ok": True}


@app.post("/api/automation/web-scrape")
async def automation_scrape(req: ScrapeRequest):
    result = automation.web_scrape(req.url, req.selector, req.headless)
    return _serialize_auth_result(result)


@app.post("/api/automation/browser-task")
async def automation_browser_task(req: BrowserTaskRequest):
    result = automation.browser_task(req.steps, req.headless)
    return _serialize_auth_result(result)


@app.post("/api/automation/desktop-action")
async def automation_desktop_action(req: DesktopActionRequest):
    result = automation.desktop_action(req.command, req.params)
    return _serialize_auth_result(result)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    # WebSockets bypass the HTTP middleware above, so enforce the same trust
    # boundary on the handshake (Origin / Host / bearer token).
    if not _trusted(ws.headers):
        await ws.close(code=1008)
        return
    await ws.accept()
    ws_clients.append(ws)
    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
                action = msg.get("action", "")
                payload = msg.get("payload", {})
                resp = await orchestrator.execute(
                    payload.get("agent", "chat"),
                    action,
                    payload,
                )
                await ws.send_json({"action": action, "response": resp.model_dump()})
            except Exception as exc:  # noqa: BLE001
                await ws.send_json({"error": str(exc)})
    except WebSocketDisconnect:
        if ws in ws_clients:
            ws_clients.remove(ws)


async def _broadcast(channel: str, data: dict) -> None:
    dead: list[WebSocket] = []
    for ws in ws_clients:
        try:
            await ws.send_json({"channel": channel, "data": data})
        except Exception:  # noqa: BLE001
            dead.append(ws)
    for ws in dead:
        if ws in ws_clients:
            ws_clients.remove(ws)


def _serialize_auth_result(result: Any) -> dict:
    """Flatten AutomationResult for JSON transport."""
    if hasattr(result, "ok"):
        return {
            "ok": result.ok,
            "data": result.data,
            "logs": getattr(result, "logs", []),
            "error": {
                "code": result.error.code,
                "message": result.error.message,
                "detail": getattr(result.error, "detail", ""),
            }
            if result.error
            else None,
        }
    return {"ok": False, "data": None, "logs": [], "error": None}


def run_server() -> None:
    import uvicorn

    uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT, log_level="info")


if __name__ == "__main__":
    run_server()

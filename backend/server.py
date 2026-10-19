from __future__ import annotations
import json
from contextlib import asynccontextmanager
from typing import Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from .config import SERVER_HOST, SERVER_PORT
from .agents.orchestrator import Orchestrator
from .services.automation import automation


orchestrator = Orchestrator()
ws_clients: list[WebSocket] = []


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


app = FastAPI(title="SPRYGEN Multi-Agent Backend", version="3.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


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

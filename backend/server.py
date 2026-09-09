from __future__ import annotations
import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from .config import SERVER_HOST, SERVER_PORT
from .db import db
from .agents.orchestrator import Orchestrator
from .services.automation import automation


orchestrator = Orchestrator()
ws_clients: list[WebSocket] = []


class ChatRequest(BaseModel):
    text: str
    history: list[dict[str, Any]] = []
    profile: dict[str, Any] = {}


class TaskCreateRequest(BaseModel):
    title: str
    dueAt: int | None = None
    source: str = "python"


class TaskUpdateRequest(BaseModel):
    completed: bool | None = None
    title: str | None = None


class ProfileUpdateRequest(BaseModel):
    phrasingStyle: str | None = None
    activeHours: dict[str, int] | None = None


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
    return {"status": "ok", "agents": [orchestrator.coordinator.name] + [a.name for a in orchestrator.coordinator._agent_registry.values()]}


@app.post("/api/chat")
async def chat(req: ChatRequest):
    result = await orchestrator.route(req.text, req.history, req.profile)
    db.insert("chat", {
        "id": db.gen_id(),
        "role": "user",
        "text": req.text,
        "intent": result.get("intent"),
        "createdAt": _now_ms(),
    })
    db.insert("chat", {
        "id": db.gen_id(),
        "role": "assistant",
        "text": result.get("answer", ""),
        "intent": result.get("intent"),
        "createdAt": _now_ms(),
    })
    await _broadcast("chat:update", {})
    return result


@app.get("/api/chat/history")
async def chat_history():
    return db.all("chat")


@app.get("/api/tasks")
async def tasks_list():
    return db.all("tasks")


@app.post("/api/tasks")
async def tasks_create(req: TaskCreateRequest):
    task = {
        "id": db.gen_id(),
        "title": req.title,
        "completed": 0,
        "createdAt": _now_ms(),
        "dueAt": req.dueAt,
        "source": req.source,
        "tags": "[]",
    }
    db.insert("tasks", task)
    await _broadcast("tasks:update", {})
    return task


@app.patch("/api/tasks/{task_id}")
async def tasks_update(task_id: str, req: TaskUpdateRequest):
    patch: dict[str, Any] = {}
    if req.completed is not None:
        patch["completed"] = 1 if req.completed else 0
    if req.title is not None:
        patch["title"] = req.title
    result = db.update("tasks", task_id, patch)
    await _broadcast("tasks:update", {})
    return result or {"error": "not found"}


@app.delete("/api/tasks/{task_id}")
async def tasks_remove(task_id: str):
    db.remove("tasks", task_id)
    await _broadcast("tasks:update", {})
    return {"ok": True}


@app.get("/api/briefing")
async def briefing():
    resp = await orchestrator.execute("briefing", "generate")
    return resp.payload.get("items", [])


@app.get("/api/profile")
async def profile_get():
    profiles = db.all("profile")
    return profiles[0] if profiles else {
        "activeHours": {"start": 9, "end": 22},
        "phrasingStyle": "concise",
        "recurringCategories": [],
        "learnedFacts": [],
        "summary": "",
    }


@app.post("/api/profile")
async def profile_set(req: ProfileUpdateRequest):
    profiles = db.all("profile")
    if profiles:
        p = profiles[0]
        patch: dict[str, Any] = {}
        if req.phrasingStyle is not None:
            patch["phrasingStyle"] = req.phrasingStyle
        if req.activeHours is not None:
            patch["activeHours"] = req.activeHours
        db.update("profile", p["id"], patch)
    else:
        db.insert("profile", {
            "id": db.gen_id(),
            "activeHours": req.activeHours or {"start": 9, "end": 22},
            "phrasingStyle": req.phrasingStyle or "concise",
            "recurringCategories": [],
            "learnedFacts": [],
            "summary": "",
        })
    return await profile_get()


@app.get("/api/facts")
async def facts_list():
    return db.all("facts")


@app.delete("/api/facts/{key}")
async def facts_delete(key: str):
    facts = db.all("facts")
    for f in facts:
        if f.get("key") == key:
            db.remove("facts", f["id"])
            return {"ok": True}
    return {"ok": False}


@app.post("/api/recall")
async def recall(body: dict):
    text = body.get("text", "")
    resp = await orchestrator.execute("memory", "recall", {"text": text})
    return resp.payload


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


@app.get("/api/integrations")
async def integrations():
    adapters = [
        {"id": "whatsapp-web", "label": "WhatsApp Web", "description": "Parses deadline messages", "status": "dead", "lastSyncAt": None},
        {"id": "notif-mirror", "label": "Notification Mirror", "description": "Phone notification forwarding", "status": "dead", "lastSyncAt": None},
        {"id": "manual-capture", "label": "Quick Capture", "description": "Clipboard hotkey capture", "status": "healthy", "lastSyncAt": None},
    ]
    return adapters


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
            except Exception as exc:
                await ws.send_json({"error": str(exc)})
    except WebSocketDisconnect:
        ws_clients.remove(ws)


async def _broadcast(channel: str, data: dict) -> None:
    dead: list[WebSocket] = []
    for ws in ws_clients:
        try:
            await ws.send_json({"channel": channel, "data": data})
        except Exception:
            dead.append(ws)
    for ws in dead:
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


def _now_ms() -> int:
    import time
    return int(time.time() * 1000)


def run_server() -> None:
    import uvicorn
    uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT, log_level="info")


if __name__ == "__main__":
    run_server()

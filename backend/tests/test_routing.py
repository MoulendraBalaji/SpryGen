"""Phase 8 routing regression tests.

Four misrouting cases that should NOT be intercepted by anchored rules, plus
natural language phrasing that must result in a task creation action (via the
LLM tool-calling path when mocked), and a recall phrase that must create a
memory action (anchored fast-path).
"""

from __future__ import annotations

import asyncio
import json

from backend.llm import router


def _chat_toolcall(result: dict | None = None) -> callable:
    async def fake_chat(messages, tools=None, require_local=False, require_tools=False):
        if result is None:
            return {"ok": True, "provider": "ollama", "message": {"content": "ok"}}
        return result

    return fake_chat


def _make_tool_choice(tool_name: str, payload: dict) -> dict:
    return {
        "ok": True,
        "provider": "ollama",
        "message": {
            "tool_calls": [
                {
                    "id": "call-1",
                    "function": {"name": tool_name, "arguments": json.dumps(payload)},
                }
            ]
        },
    }


def test_general_questions_route_to_chat(monkeypatch):
    monkeypatch.setattr(router.providers, "chat", _chat_toolcall())
    cases = [
        "what is your address",
        "how do I create a react component",
        "give me a summary of this article",
        "what's the schedule for the Champions League",
    ]
    async def run_case(p):
        r = await router.route({"text": p, "profile": {}, "tasks": [], "facts": []})
        assert r["intent"] == "chat"
        assert r.get("actions") in ([], None)
        assert "answer" in r

    for phrase in cases:
        asyncio.run(run_case(phrase))


def test_add_milk_to_shopping_list_creates_task(monkeypatch):
    toolcall = _make_tool_choice("create_task", {"title": "buy milk", "source": "manual"})
    monkeypatch.setattr(router.providers, "chat", _chat_toolcall(toolcall))
    async def run_case():
        r = await router.route({"text": "add milk to my shopping list", "profile": {}, "tasks": [], "facts": []})
        assert r["intent"] == "task.create"
        actions = r["actions"] or []
        assert actions
        assert actions[0]["type"] == "task.create"
        payload = actions[0]["payload"]
        assert payload.get("title") == "buy milk" or "buy milk" in str(payload)

    asyncio.run(run_case())


def test_remember_locker_code_creates_memory(monkeypatch):
    # Anchored fast-path — no provider call needed.
    async def run_case():
        r = await router.route({"text": "remember that my locker code is 4821", "profile": {}, "tasks": [], "facts": []})
        assert r["intent"] == "memory.store"
        actions = r["actions"] or []
        assert actions
        assert actions[0]["type"] == "memory.store"
        # Anchor passes the remainder through; ensure the value is preserved.
        assert actions[0]["payload"]["value"] == "my locker code is 4821"
        assert actions[0]["requiresConfirmation"] is False

    asyncio.run(run_case())

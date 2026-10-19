"""Intent-router tests: anchored fast-paths, tool-calling, chat fallbacks."""

from __future__ import annotations
import asyncio

from backend.llm import router


def _chat_ok(content="Sure, here is an answer."):
    async def fake_chat(messages, tools=None, require_local=False, require_tools=False):
        return {"ok": True, "provider": "ollama", "message": {"content": content}}

    return fake_chat


def test_anchored_task():
    result = router.anchored_route("remind me to call the dentist")
    assert result["intent"] == "task.create"
    assert result["actions"][0]["payload"]["title"] == "call the dentist"
    assert result["actions"][0]["requiresConfirmation"] is False


def test_anchored_todo():
    result = router.anchored_route("todo: submit the essay")
    assert result["intent"] == "task.create"
    assert result["actions"][0]["payload"]["title"] == "submit the essay"


def test_anchored_remember():
    result = router.anchored_route("remember that my locker code is 4829")
    assert result["intent"] == "memory.store"
    assert result["actions"][0]["payload"]["value"] == "my locker code is 4829"


def test_anchored_does_not_match_general_questions():
    for text in (
        "what is your address",
        "how do I create a react component",
        "give me a summary of this article",
    ):
        assert router.anchored_route(text) is None


def test_general_questions_route_to_chat(monkeypatch):
    monkeypatch.setattr(router.providers, "chat", _chat_ok())
    for text in (
        "what is your address",
        "how do I create a react component",
        "give me a summary of this article",
        "what's the schedule for the Champions League",
    ):
        result = asyncio.run(router.route({"text": text, "profile": {}, "tasks": [], "facts": []}))
        assert result["intent"] == "chat", text
        assert result["actions"] == [], text


def test_privacy_gate():
    assert router.requires_local({"text": "remember that my passport expires in May"}) is True
    assert router.requires_local({"text": "my schedule for tomorrow"}) is True
    assert router.requires_local({"text": "what is your address"}) is False
    assert router.requires_local({"text": "how do I create a react component"}) is False
    assert router.requires_local({"text": "hi", "private": True}) is True


def test_tool_call_create_task(monkeypatch):
    async def fake_chat(messages, tools=None, require_local=False, require_tools=False):
        return {
            "ok": True,
            "provider": "groq",
            "message": {
                "content": "",
                "tool_calls": [
                    {"id": "1", "function": {"name": "create_task", "arguments": '{"title": "buy milk"}'}}
                ],
            },
        }

    monkeypatch.setattr(router.providers, "chat", fake_chat)
    result = asyncio.run(router.route({"text": "please add buy milk", "tasks": [], "facts": []}))
    assert result["intent"] == "task.create"
    assert result["actions"][0]["type"] == "task.create"
    assert result["actions"][0]["requiresConfirmation"] is True


def test_read_only_tool_is_fulfilled_locally(monkeypatch):
    async def fake_chat(messages, tools=None, require_local=False, require_tools=False):
        return {
            "ok": True,
            "provider": "groq",
            "message": {"content": "", "tool_calls": [{"id": "1", "function": {"name": "list_tasks", "arguments": "{}"}}]},
        }

    monkeypatch.setattr(router.providers, "chat", fake_chat)
    tasks = [{"id": "t1", "title": "Physics lab", "completed": 0}]
    result = asyncio.run(router.route({"text": "what are my tasks", "tasks": tasks, "facts": []}))
    assert "Physics lab" in result["answer"]
    assert result["actions"] == []


def test_falls_back_to_plain_chat_without_tools_provider(monkeypatch):
    calls: list[bool] = []

    async def fake_chat(messages, tools=None, require_local=False, require_tools=False):
        calls.append(tools is not None)
        if tools:
            return {"ok": False, "provider": None, "code": "no_provider", "error": "no provider"}
        return {"ok": True, "provider": "ollama", "message": {"content": "plain local answer"}}

    monkeypatch.setattr(router.providers, "chat", fake_chat)
    result = asyncio.run(router.route({"text": "how do I create a react component", "tasks": [], "facts": []}))
    assert result["intent"] == "chat"
    assert result["answer"] == "plain local answer"
    assert calls == [True, False]

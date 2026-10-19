"""Intent routing + chat for the stateless backend.

Routing order:
1. Anchored fast-path regexes (explicit, unambiguous commands).
2. LLM tool-calling on a tools-capable provider.
3. Plain chat on any provider.

Side-effecting tool calls are returned as proposed actions with
``requiresConfirmation: true``; read-only tools are answered locally.
"""

from __future__ import annotations
import json
import re
from typing import Any

from . import providers
from .tools import ACTION_FOR_TOOL, READ_ONLY_TOOLS, TOOLS
from ..agents.task_agent import TaskAgent
from ..agents.memory_agent import MemoryAgent

_task_agent = TaskAgent()
_memory_agent = MemoryAgent()

ANCHOR_TASK = re.compile(r"^(?:remind me to|todo:)\s*(.+)$", re.IGNORECASE)
ANCHOR_REMEMBER = re.compile(r"^remember that\s+(.+)$", re.IGNORECASE)

PERSONAL_RE = re.compile(
    r"\b(remember|recall|memory|what did i|"
    r"my (?:password|passcode|locker|address|passport|ssn|bank|schedule|tasks?)|"
    r"schedule|reminder|birthday|todo|voiceprint)\b",
    re.IGNORECASE,
)


def requires_local(payload: dict[str, Any]) -> bool:
    """Privacy gate: personal data must never leave the device.

    True when the request is explicitly private, carries screen/voice/
    notification content, or is about personal memory/schedule data.
    """
    if payload.get("private"):
        return True
    for key in ("screen", "screenText", "voice", "voiceprint", "notification"):
        if payload.get(key):
            return True
    return bool(PERSONAL_RE.search(str(payload.get("text", ""))))


def build_system_prompt(profile: dict | None, include_facts: bool = False) -> str:
    profile = profile or {}
    style = profile.get("phrasingStyle", "concise")
    parts = [
        "You are SPRYGEN, a helpful, local-first desktop assistant.",
        f"Respond in a {style} style. Be concise and direct.",
        "Only call a tool when the user clearly asks for it. For general questions, "
        "coding help, summaries, news or explanations, answer directly without tools.",
    ]
    if include_facts:
        facts = profile.get("learnedFacts") or []
        if facts:
            lines = [f"- {f.get('key')}: {f.get('value')}" for f in facts[:20] if isinstance(f, dict)]
            if lines:
                parts.append("Known facts about the user:\n" + "\n".join(lines))
    return "\n".join(parts)


def _messages(payload: dict, include_facts: bool) -> list[dict]:
    messages = [{"role": "system", "content": build_system_prompt(payload.get("profile"), include_facts)}]
    for item in (payload.get("history") or [])[-20:]:
        role = item.get("role", "user")
        if role not in ("user", "assistant", "system"):
            role = "user"
        messages.append({"role": role, "content": item.get("content", item.get("text", ""))})
    messages.append({"role": "user", "content": str(payload.get("text", ""))})
    return messages


def anchored_route(text: str) -> dict[str, Any] | None:
    stripped = text.strip()
    match = ANCHOR_TASK.match(stripped)
    if match and match.group(1).strip():
        title = match.group(1).strip().rstrip(".")
        return {
            "intent": "task.create",
            "params": {"title": title},
            "answer": f"Task created: {title}",
            "provider": "regex",
            "actions": [
                {
                    "type": "task.create",
                    "payload": {"title": title, "source": "chat_nlp"},
                    "requiresConfirmation": False,
                }
            ],
        }
    match = ANCHOR_REMEMBER.match(stripped)
    if match and match.group(1).strip():
        value = match.group(1).strip().rstrip(".")
        return {
            "intent": "memory.store",
            "params": {"value": value},
            "answer": f"Got it! I'll remember: {value}",
            "provider": "regex",
            "actions": [
                {"type": "memory.store", "payload": {"key": value[:80], "value": value}, "requiresConfirmation": False}
            ],
        }
    return None


def _local_answer(tool_name: str, args: dict, payload: dict) -> str:
    if tool_name == "list_tasks":
        return _task_agent._list_answer(payload.get("tasks") or []).payload.get("answer", "")
    if tool_name == "recall":
        return _memory_agent._recall_answer(str(args.get("query", "")), payload.get("facts") or []).payload.get(
            "answer", ""
        )
    return ""


async def route(payload: dict[str, Any]) -> dict[str, Any]:
    text = str(payload.get("text", ""))
    local = requires_local(payload)

    fast = anchored_route(text)
    if fast:
        return {**fast, "routedTo": "python", "success": True}

    result = await providers.chat(_messages(payload, local), tools=TOOLS, require_local=local)
    used_tools_provider = result.get("code") != "no_provider"

    if not result.get("ok") and not used_tools_provider:
        # No tools-capable provider: fall back to plain chat.
        result = await providers.chat(_messages(payload, local), require_local=local)
    elif not result.get("ok"):
        result = await providers.chat(_messages(payload, local), require_local=local)

    if not result.get("ok"):
        return {
            "intent": "error",
            "params": {},
            "answer": "I couldn't reach a local or cloud language model. Start Ollama or add a free API key (see .env.example).",
            "provider": None,
            "actions": [],
            "routedTo": "python",
            "success": False,
            "error": result.get("error"),
        }

    provider = result.get("provider")
    message = result.get("message") or {}
    tool_calls = message.get("tool_calls") or []

    if tool_calls:
        return _handle_tool_calls(tool_calls, payload, provider)

    return {
        "intent": "chat",
        "params": {},
        "answer": message.get("content") or "",
        "provider": provider,
        "actions": [],
        "routedTo": "python",
        "success": True,
    }


def _handle_tool_calls(tool_calls: list[dict], payload: dict, provider: str | None) -> dict[str, Any]:
    actions: list[dict] = []
    local_answers: list[str] = []
    intent = "chat"

    for call in tool_calls:
        fn = call.get("function") or {}
        name = fn.get("name", "")
        try:
            args = json.loads(fn.get("arguments") or "{}")
        except (TypeError, ValueError):
            args = {}

        if name in READ_ONLY_TOOLS:
            answer = _local_answer(name, args, payload)
            if answer:
                local_answers.append(answer)
            continue

        action_type = ACTION_FOR_TOOL.get(name)
        if not action_type:
            continue
        actions.append(
            {"type": action_type, "payload": args, "requiresConfirmation": True}
        )
        if name == "create_task":
            intent = "task.create"
        elif name == "remember":
            intent = "memory.store"
        elif name == "open_app":
            intent = "automation.openApp"
        elif name == "scrape_url":
            intent = "search.web"
        elif name == "describe_screen":
            intent = "screen.describe"

    if local_answers:
        answer = "\n".join(local_answers)
    elif actions:
        answer = "I've prepared an action. Please confirm to apply it."
    else:
        answer = ""

    return {
        "intent": intent,
        "params": {},
        "answer": answer,
        "provider": provider,
        "actions": actions,
        "routedTo": "python",
        "success": True,
    }

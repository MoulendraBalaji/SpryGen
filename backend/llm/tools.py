"""Tool schemas exposed to tools-capable LLM providers.

Read-only tools (``list_tasks``, ``recall``) are fulfilled locally by the
backend from the context Electron passes in. Side-effecting tools are returned
to Electron as proposed actions and require UI confirmation.
"""

from __future__ import annotations
from typing import Any

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "create_task",
            "description": "Create a new task or reminder for the user. Only use when the user explicitly asks to add/remind.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Short task title."},
                    "dueAt": {"type": "string", "description": "Due date/time as an ISO string or natural language, optional."},
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_tasks",
            "description": "List the user's open tasks.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remember",
            "description": "Persist a personal fact the user asked to remember.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "Short label for the fact."},
                    "value": {"type": "string", "description": "The fact to store."},
                },
                "required": ["value"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "recall",
            "description": "Search the user's stored memories/facts.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "open_app",
            "description": "Open a local desktop application by name. Requires user confirmation.",
            "parameters": {
                "type": "object",
                "properties": {"target": {"type": "string"}},
                "required": ["target"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "scrape_url",
            "description": "Fetch and read the text content of a web page. Requires user confirmation.",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "describe_screen",
            "description": "Capture and describe what is currently on the user's screen using a local vision model. Requires user confirmation.",
            "parameters": {
                "type": "object",
                "properties": {"prompt": {"type": "string"}},
            },
        },
    },
]

# Tools that never change local state and can be resolved by the backend.
READ_ONLY_TOOLS = {"list_tasks", "recall"}

# Map a tool name to the action type Electron applies/confirms.
ACTION_FOR_TOOL = {
    "create_task": "task.create",
    "remember": "memory.store",
    "open_app": "automation.openApp",
    "scrape_url": "scrape_url",
    "describe_screen": "screen.describe",
}

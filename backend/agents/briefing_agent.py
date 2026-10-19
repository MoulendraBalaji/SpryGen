from __future__ import annotations
from typing import Any
from .base import BaseAgent, AgentMessage, AgentResponse


class BriefingAgent(BaseAgent):
    """Stateless briefing agent.

    Builds a short summary from the tasks/assignments supplied in the request.
    The authoritative briefing is rendered by Electron from its own store; this
    handler only answers briefing questions asked in chat.
    """

    name = "briefing"
    description = "Summarises tasks and assignments passed in the request (stateless)"

    def _register_handlers(self) -> None:
        self.on("handle", self._handle)
        self.on("generate", self._generate)

    async def _handle(self, msg: AgentMessage) -> AgentResponse:
        return await self._generate(msg)

    async def _generate(self, msg: AgentMessage) -> AgentResponse:
        tasks = msg.payload.get("tasks") or []
        assignments = msg.payload.get("assignments") or []
        items: list[dict[str, Any]] = []
        for task in tasks:
            if not task.get("completed"):
                items.append({"kind": "task", "title": task.get("title", ""), "dueAt": task.get("dueAt")})
        for assignment in assignments:
            items.append(
                {
                    "kind": "assignment",
                    "title": f"{assignment.get('course', '')}: {assignment.get('title', '')}",
                    "dueAt": assignment.get("dueAt"),
                }
            )
        if not items:
            answer = "You have nothing on your plate right now."
        else:
            lines = [f"\u2022 {item['title']}" for item in items[:10]]
            answer = f"Here is your briefing ({len(items)} item{'s' if len(items) != 1 else ''}):\n" + "\n".join(lines)
        return AgentResponse(
            source=self.name,
            action="generate",
            payload={"intent": "briefing.generate", "answer": answer, "items": items, "actions": []},
        )

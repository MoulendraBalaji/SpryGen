from __future__ import annotations
import re
from typing import Any
from .base import BaseAgent, AgentMessage, AgentResponse


class TaskAgent(BaseAgent):
    """Stateless task agent.

    It never reads or writes a database. It turns natural-language task intent
    into a proposed ``task.create`` action that the Electron main process applies
    exactly once.
    """

    name = "task"
    description = "Proposes task CRUD actions from natural language (stateless)"

    def _register_handlers(self) -> None:
        self.on("handle", self._handle)
        self.on("list", self._list)

    async def _handle(self, msg: AgentMessage) -> AgentResponse:
        text = msg.payload.get("text", "")
        intent = msg.payload.get("intent", "")
        params = msg.payload.get("params", {})
        tasks = msg.payload.get("tasks") or []

        if intent == "task.create":
            title = params.get("title") or self._extract_task_title(text)
            if title:
                return AgentResponse(
                    source=self.name,
                    action="handle",
                    payload={
                        "intent": "task.create",
                        "answer": f"Task created: {title}",
                        "actions": [
                            {
                                "type": "task.create",
                                "payload": {
                                    "title": title,
                                    "dueAt": params.get("dueAt"),
                                    "source": "chat_nlp",
                                },
                            }
                        ],
                    },
                )
            return AgentResponse(
                source=self.name,
                action="handle",
                payload={
                    "intent": "task.create",
                    "answer": "What task would you like me to create?",
                    "actions": [],
                },
            )

        if intent == "task.list":
            return self._list_answer(tasks)

        return AgentResponse(
            source=self.name,
            action="handle",
            payload={
                "intent": "task",
                "answer": "I can help you create or list tasks. What would you like to do?",
                "actions": [],
            },
        )

    async def _list(self, msg: AgentMessage) -> AgentResponse:
        return self._list_answer(msg.payload.get("tasks") or [])

    def _list_answer(self, tasks: list[dict[str, Any]]) -> AgentResponse:
        open_tasks = [t for t in tasks if not t.get("completed")]
        if not open_tasks:
            answer = "You have no open tasks. Nice work!"
        else:
            lines = [f"\u2022 {t.get('title', '')}" for t in open_tasks[:10]]
            answer = f"You have {len(open_tasks)} open tasks:\n" + "\n".join(lines)
        return AgentResponse(
            source=self.name,
            action="handle",
            payload={"intent": "task.list", "answer": answer, "actions": []},
        )

    @staticmethod
    def _extract_task_title(text: str) -> str:
        patterns = [
            r"(?:create|add|make|set|remind me (?:to)?)\s+(?:a\s+)?(?:task\s+(?:to\s+)?)?(.+)",
            r"todo:?\s+(.+)",
        ]
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                return m.group(1).strip().rstrip(".")
        return text.strip()

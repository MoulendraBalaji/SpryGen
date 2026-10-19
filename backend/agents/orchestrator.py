from __future__ import annotations
from typing import Any
from .base import AgentMessage
from .coordinator import CoordinatorAgent
from .task_agent import TaskAgent
from .chat_agent import ChatAgent
from .memory_agent import MemoryAgent
from .briefing_agent import BriefingAgent


class Orchestrator:
    def __init__(self) -> None:
        self.coordinator = CoordinatorAgent()
        self.task_agent = TaskAgent()
        self.chat_agent = ChatAgent()
        self.memory_agent = MemoryAgent()
        self.briefing_agent = BriefingAgent()

        self.coordinator.register_agent(self.task_agent)
        self.coordinator.register_agent(self.chat_agent)
        self.coordinator.register_agent(self.memory_agent)
        self.coordinator.register_agent(self.briefing_agent)

    async def route(
        self,
        text: str,
        history: list[dict] | None = None,
        profile: dict | None = None,
        tasks: list[dict] | None = None,
        facts: list[dict] | None = None,
        assignments: list[dict] | None = None,
    ) -> dict[str, Any]:
        intent = self._classify_intent(text)
        params = self._extract_params(text, intent)

        msg = AgentMessage(
            sender="electron",
            recipient="coordinator",
            action="route",
            payload={
                "text": text,
                "intent": intent,
                "params": params,
                "history": (history or [])[-20:],
                "profile": profile or {},
                "tasks": tasks or [],
                "facts": facts or [],
                "assignments": assignments or [],
            },
        )
        response = await self.coordinator.handle(msg)
        payload = response.payload or {}
        return {
            "intent": payload.get("intent", intent),
            "params": params,
            "routedTo": "python",
            "answer": payload.get("answer", ""),
            "actions": payload.get("actions", []),
            "success": response.success,
            "error": response.error,
        }

    async def execute(self, agent_name: str, action: str, payload: dict | None = None):
        msg = AgentMessage(
            sender="electron",
            recipient="coordinator",
            action="route",
            payload={
                "target_agent": agent_name,
                "text": (payload or {}).get("text", ""),
                **(payload or {}),
            },
        )
        return await self.coordinator.handle(msg)

    @staticmethod
    def _classify_intent(text: str) -> str:
        lower = text.lower()
        task_kw = ["remind me", "todo:", "add a task", "create a task", "new task", "task to"]
        memory_kw = ["remember that", "remember ", "recall", "what do you know"]
        briefing_kw = ["briefing", "what's on my schedule", "what do i have", "my schedule"]
        if any(k in lower for k in task_kw):
            return "task.create"
        if any(k in lower for k in memory_kw):
            return "memory.store" if "remember" in lower else "memory.recall"
        if any(k in lower for k in briefing_kw):
            return "briefing.generate"
        return "chat"

    @staticmethod
    def _extract_params(text: str, intent: str) -> dict:
        params: dict = {}
        if intent == "task.create":
            import re

            match = re.search(
                r"(?:remind me to|create a task to|add a task to|add task|todo:?)\s*(.+)",
                text,
                re.IGNORECASE,
            )
            if match:
                params["title"] = match.group(1).strip().rstrip(".")
        return params

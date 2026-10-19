from __future__ import annotations
from typing import Any
from .base import AgentMessage
from .coordinator import CoordinatorAgent
from .task_agent import TaskAgent
from .chat_agent import ChatAgent
from .memory_agent import MemoryAgent
from .briefing_agent import BriefingAgent
from ..llm import router as intent_router


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
        """Stateless routing: anchored regex -> LLM tool-calling -> plain chat."""
        return await intent_router.route(
            {
                "text": text,
                "history": (history or [])[-20:],
                "profile": profile or {},
                "tasks": tasks or [],
                "facts": facts or [],
                "assignments": assignments or [],
            }
        )

    async def execute(self, agent_name: str, action: str, payload: dict | None = None):
        msg = AgentMessage(
            sender="electron",
            recipient="coordinator",
            action="route",
            payload={"target_agent": agent_name, **(payload or {})},
        )
        return await self.coordinator.handle(msg)

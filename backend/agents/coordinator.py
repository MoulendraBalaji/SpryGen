from __future__ import annotations
from typing import Any
from .base import BaseAgent, AgentMessage, AgentResponse


class CoordinatorAgent(BaseAgent):
    name = "coordinator"
    description = "Routes messages to the correct agent based on intent and context"

    def __init__(self) -> None:
        self._agent_registry: dict[str, BaseAgent] = {}
        super().__init__()

    def register_agent(self, agent: BaseAgent) -> None:
        self._agent_registry[agent.name] = agent

    def _register_handlers(self) -> None:
        self.on("route", self._handle_route)
        self.on("list_agents", self._handle_list_agents)

    def _request_context(self, msg: AgentMessage) -> dict[str, Any]:
        """Context every stateless agent needs to answer without a database."""
        payload = msg.payload
        return {
            "text": payload.get("text", ""),
            "intent": payload.get("intent", ""),
            "params": payload.get("params", {}),
            "history": payload.get("history", []),
            "profile": payload.get("profile", {}),
            "tasks": payload.get("tasks", []),
            "assignments": payload.get("assignments", []),
            "facts": payload.get("facts", []),
        }

    async def _handle_route(self, msg: AgentMessage) -> AgentResponse:
        target = msg.payload.get("target_agent")
        mapped = target or self._map_intent(msg.payload.get("intent", ""))
        if mapped and mapped in self._agent_registry:
            agent = self._agent_registry[mapped]
            inner = AgentMessage(
                sender=msg.sender,
                recipient=mapped,
                action="handle",
                payload=self._request_context(msg),
            )
            return await agent.handle(inner)

        return AgentResponse(
            source=self.name,
            action="route",
            success=False,
            error=f"No agent found for intent: {msg.payload.get('intent', '')}",
        )

    async def _handle_list_agents(self, msg: AgentMessage) -> AgentResponse:
        agents_info = [
            {"name": a.name, "description": a.description, "actions": a.list_actions()}
            for a in self._agent_registry.values()
        ]
        return AgentResponse(
            source=self.name,
            action="list_agents",
            payload={"agents": agents_info},
        )

    @staticmethod
    def _map_intent(intent: str) -> str | None:
        mapping: dict[str, str] = {
            "task.create": "task",
            "task.list": "task",
            "task.complete": "task",
            "task.remove": "task",
            "chat": "chat",
            "memory.store": "memory",
            "memory.recall": "memory",
            "briefing.generate": "briefing",
        }
        return mapping.get(intent)

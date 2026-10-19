from __future__ import annotations
import time
from typing import Any
from .base import BaseAgent, AgentMessage, AgentResponse
from ..llm import providers, router as intent_router


class ChatAgent(BaseAgent):
    """Thin chat agent backed by the shared provider chain.

    All provider selection, fallback and privacy gating live in
    ``backend.llm.providers`` so there is a single source of truth.
    """

    name = "chat"
    description = "Answers conversational messages via the free provider chain"

    def _register_handlers(self) -> None:
        self.on("handle", self._handle)

    async def _handle(self, msg: AgentMessage) -> AgentResponse:
        payload = msg.payload
        text = payload.get("text", "")
        local = intent_router.requires_local(payload)
        messages = intent_router._messages(payload, local)
        result = await providers.chat(messages, require_local=local)
        if result.get("ok"):
            answer = (result.get("message") or {}).get("content", "")
        else:
            answer = self._local_fallback(text)
        return AgentResponse(
            source=self.name,
            action="handle",
            payload={"intent": "chat", "answer": answer, "actions": [], "provider": result.get("provider")},
        )

    @staticmethod
    def _local_fallback(text: str) -> str:
        lower = text.lower()
        if "hello" in lower or "hi" in lower or "hey" in lower:
            return "Hello! I'm SPRYGEN. How can I help you today?"
        if "time" in lower:
            return f"The current time is {time.strftime('%I:%M %p')}."
        if "date" in lower:
            return f"Today is {time.strftime('%B %d, %Y')}."
        if "thank" in lower:
            return "You're welcome! Let me know if you need anything else."
        return "I understand. For the best experience, start the local Ollama server or configure a free API key (see .env.example)."

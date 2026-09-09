from __future__ import annotations
import uuid
import time
from typing import Any
import httpx
from .base import BaseAgent, AgentMessage, AgentResponse
from ..db import db
from ..config import OLLAMA_URL, ANTHROPIC_API_KEY


class ChatAgent(BaseAgent):
    name = "chat"
    description = "Handles conversational AI with local Ollama or cloud LLM fallback"

    def _register_handlers(self) -> None:
        self.on("handle", self._handle)

    async def _handle(self, msg: AgentMessage) -> AgentResponse:
        text = msg.payload.get("text", "")
        history = msg.payload.get("history", [])
        profile = msg.payload.get("profile", {})

        system_prompt = self._build_system_prompt(profile)
        messages = [{"role": "system", "content": system_prompt}]
        for h in history[-20:]:
            messages.append({
                "role": h.get("role", "user"),
                "content": h.get("content", h.get("text", "")),
            })
        messages.append({"role": "user", "content": text})

        answer = await self._try_ollama(messages)
        if answer is None and ANTHROPIC_API_KEY:
            answer = await self._try_claude(messages)
        if answer is None:
            answer = self._local_fallback(text)

        return AgentResponse(
            source=self.name,
            action="handle",
            payload={"intent": "chat", "answer": answer},
        )

    async def _try_ollama(self, messages: list[dict]) -> str | None:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{OLLAMA_URL}/api/chat",
                    json={"model": "llama3.2", "messages": messages, "stream": False},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("message", {}).get("content", "")
        except Exception:
            pass
        return None

    async def _try_claude(self, messages: list[dict]) -> str | None:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": ANTHROPIC_API_KEY,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": "claude-3-5-sonnet-20241022",
                        "max_tokens": 1024,
                        "messages": messages,
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    blocks = data.get("content", [])
                    return "".join(b.get("text", "") for b in blocks)
        except Exception:
            pass
        return None

    @staticmethod
    def _build_system_prompt(profile: dict) -> str:
        style = profile.get("phrasingStyle", "concise")
        facts = profile.get("learnedFacts", [])
        fact_lines = [f"- {f['key']}: {f['value']}" for f in facts[:20]] if facts else []
        parts = [
            "You are SPRYGEN, a helpful AI desktop assistant.",
            f"Respond in a {style} style.",
        ]
        if fact_lines:
            parts.append("Known facts about the user:\n" + "\n".join(fact_lines))
        return "\n".join(parts)

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
        return "I understand. For the best experience, ensure Ollama or an Anthropic API key is configured."

from __future__ import annotations
import math
import re
from typing import Any
from .base import BaseAgent, AgentMessage, AgentResponse


class MemoryAgent(BaseAgent):
    """Stateless memory agent.

    It receives known facts in the request payload and either proposes a
    ``memory.store`` action or answers a recall query by ranking the supplied
    facts. No database access happens here.
    """

    name = "memory"
    _dim = 64

    def _register_handlers(self) -> None:
        self.on("handle", self._handle)
        self.on("recall", self._recall)

    async def _handle(self, msg: AgentMessage) -> AgentResponse:
        text = msg.payload.get("text", "")
        facts = msg.payload.get("facts") or []
        lower = text.lower()
        if "remember" in lower:
            value = self._extract_fact(text)
            if value:
                return AgentResponse(
                    source=self.name,
                    action="handle",
                    payload={
                        "intent": "memory.store",
                        "answer": f"Got it! I'll remember: {value}",
                        "actions": [
                            {
                                "type": "memory.store",
                                "payload": {"key": value[:80], "value": value},
                            }
                        ],
                    },
                )
        return self._recall_answer(text, facts)

    async def _recall(self, msg: AgentMessage) -> AgentResponse:
        return self._recall_answer(msg.payload.get("text", ""), msg.payload.get("facts") or [])

    def _recall_answer(self, text: str, facts: list[dict[str, Any]]) -> AgentResponse:
        if not facts:
            return AgentResponse(
                source=self.name,
                action="recall",
                payload={"intent": "memory.recall", "answer": "I don't have any stored memories yet.", "actions": []},
            )
        query_vec = self._embed(text)
        scored: list[tuple[float, dict[str, Any]]] = []
        for fact in facts:
            value = str(fact.get("value", fact.get("text", fact.get("key", ""))))
            scored.append((self._cosine(query_vec, self._embed(value)), fact))
        scored.sort(key=lambda pair: pair[0], reverse=True)
        top = [fact for score, fact in scored[:3] if score > 0.3]
        if not top:
            return AgentResponse(
                source=self.name,
                action="recall",
                payload={"intent": "memory.recall", "answer": "I don't know anything about that yet.", "actions": []},
            )
        lines = [f"\u2022 {f.get('value', f.get('text', ''))}" for f in top]
        return AgentResponse(
            source=self.name,
            action="recall",
            payload={
                "intent": "memory.recall",
                "answer": "Here is what I remember:\n" + "\n".join(lines),
                "actions": [],
            },
        )

    @staticmethod
    def _extract_fact(text: str) -> str:
        cleaned = re.sub(r"(?i)^.*?\bremember\s+(?:that\s+)?", "", text).strip()
        return cleaned.rstrip(".")

    def _embed(self, text: str) -> list[float]:
        vec = [0.0] * self._dim
        for word in text.lower().split():
            for i in range(0, min(len(word), 12)):
                idx = (ord(word[i]) * 31 + i * 17) % self._dim
                vec[idx] += 1.0
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]

    @staticmethod
    def _cosine(a: list[float], b: list[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        na = math.sqrt(sum(x * x for x in a)) or 1.0
        nb = math.sqrt(sum(y * y for y in b)) or 1.0
        return dot / (na * nb)

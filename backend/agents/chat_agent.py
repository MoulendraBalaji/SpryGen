from __future__ import annotations
import asyncio
import re
import time
from typing import Any
import httpx
from .base import BaseAgent, AgentMessage, AgentResponse
from ..config import OLLAMA_URL, ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY
from ..services.automation import automation

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
MAX_SCRAPED_CHARS = 8000


class ChatAgent(BaseAgent):
    name = "chat"
    description = "Handles conversational AI with Groq, Gemini, local Ollama, or cloud LLM fallback, plus web scraping"

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

        scraped = await self._maybe_scrape(text)
        if scraped:
            messages.append({
                "role": "user",
                "content": (
                    f"The user asked about content at {scraped['url']}. "
                    f"Here is the extracted page text:\n\n{scraped['text']}\n\n"
                    "Use it to answer. If the page has no relevant content, say so plainly."
                ),
            })

        answer = await self._try_groq(messages)
        if answer is None and GEMINI_API_KEY:
            answer = await self._try_gemini(messages)
        if answer is None and ANTHROPIC_API_KEY:
            answer = await self._try_claude(messages)
        if answer is None:
            answer = await self._try_ollama(messages)
        if answer is None:
            answer = self._local_fallback(text)

        payload: dict[str, Any] = {"intent": "chat", "answer": answer}
        if scraped:
            payload["scrapedUrl"] = scraped["url"]
        return AgentResponse(
            source=self.name,
            action="handle",
            payload=payload,
        )

    # ----- Web scraping tool (agent capability, not a separate API) --------
    URL_RE = re.compile(r"https?://[^\s<>\"']+")

    async def _maybe_scrape(self, text: str) -> dict[str, str] | None:
        match = self.URL_RE.search(text)
        if not match:
            return None
        intent_words = ("scrape", "read", "summarize", "analyze", "extract", "look up", "what's on", "contents", "content")
        if not any(w in text.lower() for w in intent_words):
            return None
        url = match.group(0).rstrip(".,);!?")

        def _run():
            try:
                return automation.web_scrape(url, headless=True)
            except Exception:  # noqa: BLE001
                return None

        result = await asyncio.to_thread(_run)
        articles = (result.data or {}).get("articles", []) if result and result.ok else []
        joined = "\n\n".join(articles) if isinstance(articles, list) else ""
        if not joined.strip():
            joined = "The page could not be scraped (network, auth, or parser failure)."
        return {"url": url, "text": joined[:MAX_SCRAPED_CHARS]}

    # ----- LLM providers ---------------------------------------------------
    async def _try_groq(self, messages: list[dict]) -> str | None:
        if not GROQ_API_KEY:
            return None
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                resp = await client.post(
                    GROQ_URL,
                    headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
                    json={"model": GROQ_MODEL, "messages": messages, "max_tokens": 1600},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("choices", [{}])[0].get("message", {}).get("content", "")
        except Exception:
            pass
        return None

    async def _try_gemini(self, messages: list[dict]) -> str | None:
        if not GEMINI_API_KEY:
            return None
        system_prompt = ""
        contents: list[dict] = []
        for m in messages:
            role = m.get("role", "user")
            content = m.get("content", "")
            if role == "system":
                system_prompt = content
            elif role == "user":
                contents.append({"role": "user", "parts": [{"text": content}]})
            else:
                contents.append({"role": "model", "parts": [{"text": content}]})
        if not contents:
            return None
        body: dict[str, Any] = {"contents": contents}
        if system_prompt:
            body["systemInstruction"] = {"parts": [{"text": system_prompt}]}
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                resp = await client.post(
                    f"{GEMINI_URL}?key={GEMINI_API_KEY}",
                    json={**body, "generationConfig": {"maxOutputTokens": 1600}},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        return "".join(p.get("text", "") for p in parts if p.get("text"))
                    if data.get("promptFeedback", {}).get("blockReason"):
                        return "The request was blocked by Google's safety filters."
        except Exception:
            pass
        return None

    async def _try_claude(self, messages: list[dict]) -> str | None:
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": ANTHROPIC_API_KEY,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": "claude-3-5-sonnet-20241022",
                        "max_tokens": 1600,
                        "messages": [m for m in messages if m.get("role") != "system"],
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    blocks = data.get("content", [])
                    return "".join(b.get("text", "") for b in blocks)
        except Exception:
            pass
        return None

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
        return "I understand. For the best experience, ensure Groq, Gemini, or an Anthropic API key is configured."
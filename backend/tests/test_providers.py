"""Provider-chain tests: fallback, cooldowns, privacy gate."""

from __future__ import annotations
import asyncio
import time

from backend.llm import providers


class FakeResponse:
    def __init__(self, status_code: int, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload or {}
        self.headers = headers or {}

    def json(self):
        return self._payload


def _ok(content: str) -> FakeResponse:
    return FakeResponse(200, {"choices": [{"message": {"content": content}}]})


def test_skips_providers_without_key(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDERS", "groq,ollama")
    names = [p.name for p in providers.resolve()]
    assert names == ["ollama"]  # groq has no key configured


def test_falls_through_on_429(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDERS", "groq,ollama")
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    calls: list[str] = []

    async def fake_call(cfg, messages, tools, model):
        calls.append(cfg.name)
        if cfg.name == "groq":
            return FakeResponse(429, {"error": "rate limited"}, {"Retry-After": "7"})
        return _ok("hello from ollama")

    monkeypatch.setattr(providers, "_call", fake_call)
    result = asyncio.run(providers.chat([{"role": "user", "content": "hi"}]))

    assert result["ok"] is True
    assert result["provider"] == "ollama"
    assert calls == ["groq", "ollama"]
    assert providers._cooldown_until["groq"] > time.time() + 5


def test_falls_through_on_500(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDERS", "groq,ollama")
    monkeypatch.setenv("GROQ_API_KEY", "test-key")

    async def fake_call(cfg, messages, tools, model):
        if cfg.name == "groq":
            return FakeResponse(503)
        return _ok("served by ollama")

    monkeypatch.setattr(providers, "_call", fake_call)
    result = asyncio.run(providers.chat([{"role": "user", "content": "hi"}]))
    assert result["provider"] == "ollama"


def test_privacy_gate_excludes_cloud(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDERS", "groq,ollama")
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    assert [p.name for p in providers.resolve(require_local=True)] == ["ollama"]


def test_no_provider_when_all_cooling(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDERS", "groq,ollama")
    monkeypatch.setenv("GROQ_API_KEY", "test-key")

    async def fake_call(cfg, messages, tools, model):
        return FakeResponse(500)

    monkeypatch.setattr(providers, "_call", fake_call)
    result = asyncio.run(providers.chat([{"role": "user", "content": "hi"}]))
    assert result["ok"] is False
    assert result["code"] == "exhausted"

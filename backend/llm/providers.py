"""OpenAI-compatible LLM provider chain with graceful fallback.

No provider SDKs are required: every provider speaks the OpenAI
``/chat/completions`` protocol. Providers are configured in ``providers.json``
so model names can be updated without a code change.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger("sprygen.llm")

CONFIG_PATH = __import__("pathlib").Path(__file__).parent.parent / "providers.json"
DEFAULT_ORDER = ["groq", "cerebras", "openrouter", "mistral", "ollama"]
DEFAULT_COOLDOWN_SECONDS = 30.0


class ProviderConfig:
    __slots__ = ("name", "base_url", "api_key_env", "chat_model", "tools_model", "supports_tools", "cloud")

    def __init__(
        self,
        name: str,
        base_url: str,
        api_key_env: str,
        chat_model: str,
        tools_model: str,
        supports_tools: bool,
        cloud: bool,
    ) -> None:
        self.name = name
        self.base_url = base_url.rstrip("/")
        self.api_key_env = api_key_env
        self.chat_model = chat_model
        self.tools_model = tools_model
        self.supports_tools = supports_tools
        self.cloud = cloud

    @property
    def api_key(self) -> str:
        return os.getenv(self.api_key_env, "") if self.api_key_env else ""

    @property
    def configured(self) -> bool:
        """A provider with a key env configured is skipped when the key is unset."""
        return (not self.api_key_env) or bool(self.api_key)


def _load_config() -> dict[str, ProviderConfig]:
    try:
        raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"[LLM] Failed to read {CONFIG_PATH}: {exc}")
        return {}
    providers: dict[str, ProviderConfig] = {}
    for name, cfg in (raw.get("providers") or {}).items():
        providers[name] = ProviderConfig(
            name=name,
            base_url=str(cfg.get("baseUrl", "")),
            api_key_env=cfg.get("apiKeyEnv", "") or "",
            chat_model=cfg.get("chatModel", ""),
            tools_model=cfg.get("toolsModel") or cfg.get("chatModel", ""),
            supports_tools=bool(cfg.get("supportsTools", True)),
            cloud=bool(cfg.get("cloud", True)),
        )
    return providers


_config: dict[str, "ProviderConfig"] = _load_config()


def reload_config() -> None:
    global _config
    _config = _load_config()


def provider_order() -> list[str]:
    raw = (os.getenv("LLM_PROVIDERS") or "").strip()
    order = [p.strip() for p in raw.split(",") if p.strip()] if raw else []
    if not order:
        order = list(_config.keys()) or ["groq", "cerebras", "openrouter", "mistral", "ollama"]
    for name in _config:
        if name not in order:
            order.append(name)
    return order


def base_url(cfg: "ProviderConfig") -> str:
    if cfg.name == "ollama":
        env = os.getenv("SPRYGEN_OLLAMA_URL")
        if env:
            env = env.rstrip("/")
            return env if env.endswith("/v1") else f"{env}/v1"
    return cfg.base_url


def resolve(require_local: bool = False, require_tools: bool = False) -> list["ProviderConfig"]:
    """Return the ordered list of usable providers.

    Skips: unknown names, providers missing a required API key, cloud providers
    when ``require_local`` (the privacy gate), and non-tools providers when
    ``require_tools``.
    """
    out: list[ProviderConfig] = []
    for name in provider_order():
        cfg = _config.get(name)
        if not cfg:
            continue
        if require_tools and not cfg.supports_tools:
            continue
        if require_local and cfg.cloud:
            continue
        if not cfg.configured:
            continue
        out.append(cfg)
    return out


_cooldown_until: dict[str, float] = {}


def _set_cooldown(name: str, seconds: float) -> None:
    _cooldown_until[name] = time.time() + max(1.0, seconds)


def _retry_after(resp) -> float:
    raw = (resp.headers.get("Retry-After") if resp is not None else None) or ""
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 30.0


async def _call(cfg: "ProviderConfig", messages: list[dict], tools, model: str):
    import httpx

    url = f"{base_url(cfg)}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if cfg.api_key:
        headers["Authorization"] = f"Bearer {cfg.api_key}"
    body: dict = {"model": model, "messages": messages, "max_tokens": 1200}
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        return await client.post(url, headers=headers, json=body)


async def chat(
    messages: list[dict],
    tools=None,
    require_local: bool = False,
    require_tools: bool = False,
) -> dict:
    """Try each usable provider in order and return the first successful reply.

    Returns ``{ok, provider, message, error, code}``. 429/5xx/timeout responses
    place that provider on a short cooldown (honouring ``Retry-After``) and the
    chain continues to the next provider.
    """
    import httpx

    if tools:
        require_tools = True
    candidates = resolve(require_local=require_local, require_tools=require_tools)
    if not candidates:
        return {"ok": False, "provider": None, "code": "no_provider", "error": "no provider available"}

    last_error: str | None = None
    models = [c for c in candidates if not _cooling(c.name)] or candidates
    for cfg in models:
        model = cfg.tools_model if tools else cfg.chat_model
        try:
            resp = await _call(cfg, messages, tools, model)
        except Exception as exc:  # noqa: BLE001 - timeouts / connection errors
            _set_cooldown(cfg.name, 20.0)
            last_error = f"{cfg.name}: {type(exc).__name__}"
            continue
        if resp.status_code == 200:
            try:
                data = resp.json()
                message = data["choices"][0]["message"]
            except Exception:  # noqa: BLE001
                last_error = f"{cfg.name}: malformed response"
                continue
            print(f"[SPRYGEN LLM] provider answered: {cfg.name}")
            return {"ok": True, "provider": cfg.name, "message": message, "error": None, "code": None}
        if resp.status_code == 429 or 500 <= resp.status_code < 600:
            _set_cooldown(cfg.name, _retry_after(resp))
            last_error = f"{cfg.name}: HTTP {resp.status_code}"
            continue
        last_error = f"{cfg.name}: HTTP {resp.status_code}"
    return {"ok": False, "provider": None, "code": "exhausted", "error": last_error or "all providers failed"}


def _cooling(name: str) -> bool:
    return _cooldown_until.get(name, 0.0) > time.time()

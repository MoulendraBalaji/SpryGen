"""Shared test fixtures for the SPRYGEN backend test-suite."""

from __future__ import annotations
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


@pytest.fixture(autouse=True)
def _reset_provider_state(monkeypatch):
    """Isolate provider config + cooldown between tests."""
    from backend.llm import providers

    providers._cooldown_until.clear()
    monkeypatch.delenv("LLM_PROVIDERS", raising=False)
    for key in ("GROQ_API_KEY", "CEREBRAS_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "SPRYGEN_OLLAMA_URL"):
        monkeypatch.delenv(key, raising=False)
    yield
    providers._cooldown_until.clear()

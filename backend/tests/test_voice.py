"""Local voice pipeline: capability reporting and fail-closed behaviour.

The heavy ML dependencies are intentionally absent in CI, so these tests assert
that every capability reports unavailable and that nothing is ever "verified"
when the models are missing.
"""

from __future__ import annotations

import pytest

from backend.services import voice


@pytest.fixture
def no_components(monkeypatch):
    """Force every optional component to look uninstalled."""
    monkeypatch.setattr(voice, "availability", lambda: {name: False for name in voice._COMPONENT_MODULES})


def test_status_reports_missing_components(no_components):
    status = voice.status()
    assert status["ok"] is True
    assert status["sampleRate"] == voice.SAMPLE_RATE
    assert status["running"] is False
    assert status["components"] == {
        "capture": False,
        "wake": False,
        "stt": False,
        "speaker": False,
        "tts": False,
    }


def test_sample_fails_closed_without_models(no_components):
    result = voice.sample(1.0)
    assert result["ok"] is False
    assert result["code"] == "speaker_unavailable"


def test_verify_fails_closed_without_models(no_components):
    result = voice.verify_sample([0.1, 0.2, 0.3], 1.0, 0.8)
    assert result["ok"] is False
    assert result["verified"] is False
    assert result["score"] == 0.0
    assert result["code"] == "speaker_unavailable"


def test_verify_without_reference_fails_closed(no_components):
    result = voice.verify_sample([], 1.0, 0.8)
    assert result["ok"] is False
    assert result["verified"] is False
    assert result["code"] == "no_reference"


def test_transcribe_fails_closed(no_components):
    result = voice.transcribe_sample(1.0)
    assert result["ok"] is False
    assert result["code"] == "stt_unavailable"


def test_synthesize_fails_closed_without_model(no_components):
    result = voice.synthesize("hello world")
    assert result["ok"] is False
    assert result["code"] == "tts_unavailable"


@pytest.mark.parametrize("text", ["", "   ", None])
def test_synthesize_rejects_empty_text(no_components, text):
    result = voice.synthesize(text)  # type: ignore[arg-type]
    assert result["ok"] is False
    assert result["code"] == "empty_text"


def test_start_fails_closed_without_models(no_components):
    result = voice.start([0.1, 0.2], 0.8)
    assert result["ok"] is False
    assert result["code"] == "unavailable"


def test_drain_events_empty_when_not_running(no_components):
    assert voice.drain_events() == {"ok": True, "events": []}


def test_cosine_similarity_bounds():
    assert voice.cosine([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)
    assert voice.cosine([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)
    assert voice.cosine([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)
    assert voice.cosine([], []) == 0.0
    assert voice.cosine([1.0], [1.0, 2.0]) == 0.0
    assert voice.cosine([0.0, 0.0], [1.0, 1.0]) == 0.0


def test_effective_seconds_clamped():
    assert voice._effective(None, 3.0) == 3.0
    assert voice._effective(0.0, 3.0) == 0.5
    assert voice._effective(999, 3.0) == 30.0
    assert voice._effective("not-a-number", 4.0) == 4.0

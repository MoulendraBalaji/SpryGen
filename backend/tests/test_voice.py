"""Local voice pipeline: capability reporting and fail-closed behaviour.

The heavy ML dependencies are intentionally absent in CI, so these tests assert
that every capability reports unavailable and that nothing is ever "verified"
when the models are missing.
"""

from __future__ import annotations

import math

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


# ---------------------------------------------------------------------------
# Speaker verification with synthetic audio fixtures
#
# The real stack needs Resemblyzer/sounddevice, which CI does not install, so
# these tests drive the *decision logic* with synthetic clips: `record` returns
# a generated waveform and `embed` derives a deterministic descriptor from it.
# ---------------------------------------------------------------------------

SAMPLE_RATE = voice.SAMPLE_RATE


def _clip(dc: float, frequency: float, n: int = 800, amplitude: float = 0.1) -> list[float]:
    """Synthetic clip: a DC-biased sine wave (the DC bias acts as a voice id)."""
    return [dc + amplitude * math.sin(2 * math.pi * frequency * i / SAMPLE_RATE) for i in range(n)]


def _descriptor(audio: list[float]) -> list[float]:
    """Deterministic 2-D descriptor: mean (voice id) + zero-crossing rate."""
    if not audio:
        return [0.0, 0.0]
    mean = sum(audio) / len(audio)
    crossings = 0
    for prev, cur in zip(audio, audio[1:]):
        if (prev < 0 <= cur) or (prev >= 0 > cur):
            crossings += 1
    return [mean, crossings / len(audio)]


@pytest.fixture
def synthetic_voice(monkeypatch):
    """Pretend the speaker stack is installed and wire synthetic embeddings."""
    monkeypatch.setattr(voice, "availability", lambda: {name: True for name in voice._COMPONENT_MODULES})
    monkeypatch.setattr(voice, "embed", _descriptor)
    return monkeypatch


def test_same_voice_pair_is_verified(synthetic_voice):
    reference = _descriptor(_clip(dc=0.5, frequency=220))
    synthetic_voice.setattr(voice, "record", lambda _seconds: _clip(dc=0.5, frequency=225))

    result = voice.verify_sample(reference, seconds=1.0, threshold=0.85)

    assert result["ok"] is True
    assert result["verified"] is True
    assert result["score"] > 0.85


def test_different_voice_pair_is_rejected(synthetic_voice):
    reference = _descriptor(_clip(dc=0.5, frequency=220))
    synthetic_voice.setattr(voice, "record", lambda _seconds: _clip(dc=-0.5, frequency=800))

    result = voice.verify_sample(reference, seconds=1.0, threshold=0.85)

    assert result["ok"] is True
    assert result["verified"] is False
    assert result["score"] < 0.85


def test_missing_voiceprint_fails_closed(synthetic_voice):
    result = voice.verify_sample([], seconds=1.0, threshold=0.85)

    assert result["ok"] is False
    assert result["verified"] is False
    assert result["code"] == "no_reference"
    assert result["score"] == 0.0

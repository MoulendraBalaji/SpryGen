"""Local voice pipeline: capability reporting and fail-closed behaviour.

The heavy ML dependencies are intentionally absent in CI, so these tests assert
that every capability reports unavailable and that nothing is ever "verified"
when the models are missing.
"""

from __future__ import annotations

import math
import os
import sys
from types import ModuleType, SimpleNamespace

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
    # A non-numeric string must fall back to the default, not raise.
    assert voice._effective("not-a-number", 4.0) == 4.0  # type: ignore[arg-type]


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


# ---------------------------------------------------------------------------
# Wake-word model loading
#
# Regression guard for the packaged-app bug where the engine was built with
# `Model(wakeword_models=None)`, which openWakeWord rejects with
# "object of type 'NoneType' has no len()". These tests never touch the network
# or the real openWakeWord runtime; they check the file bookkeeping and the
# errors that get surfaced to the user.
# ---------------------------------------------------------------------------


def _fake_wake_models(names: list[str]) -> dict:
    """Stand-in for ``openwakeword.MODELS`` (URLs define the expected files)."""
    return {
        name: {"download_url": f"https://example.invalid/{name}_v0.1.tflite"} for name in names
    }


def _install_openwakeword_stub(
    monkeypatch,
    names: list[str],
    *,
    model_factory: type | None = None,
    download_file=None,
) -> None:
    """Install a minimal ``openwakeword`` package that CI can import.

    CI deliberately does not install the real stack, so the module needs both an
    ``openwakeword`` namespace *and* an importable ``openwakeword.model``
    submodule for ``from openwakeword.model import Model`` to resolve.
    """
    package = ModuleType("openwakeword")
    package.MODELS = _fake_wake_models(names)  # type: ignore[attr-defined]
    package.FEATURE_MODELS = {}  # type: ignore[attr-defined]

    model_stub = ModuleType("openwakeword.model")
    model_stub.Model = model_factory or object  # type: ignore[attr-defined]

    utils_stub = ModuleType("openwakeword.utils")
    if download_file is not None:
        utils_stub.download_file = download_file  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "openwakeword", package)
    monkeypatch.setitem(sys.modules, "openwakeword.model", model_stub)
    monkeypatch.setitem(sys.modules, "openwakeword.utils", utils_stub)


def test_wake_model_dir_overridable(monkeypatch, tmp_path):
    monkeypatch.delenv("SPRYGEN_VOICE_MODELS_DIR", raising=False)
    default = voice.wake_model_dir()
    assert os.path.sep in default

    monkeypatch.setenv("SPRYGEN_VOICE_MODELS_DIR", str(tmp_path))
    assert voice.wake_model_dir() == str(tmp_path)


def test_wake_model_files_cover_wake_and_feature_models(monkeypatch, tmp_path):
    monkeypatch.setitem(sys.modules, "openwakeword", SimpleNamespace(MODELS=_fake_wake_models(["alpha", "beta"])))

    files = voice._wake_model_files(str(tmp_path))

    basenames = {os.path.basename(path) for path in files}
    assert {"alpha_v0.1.onnx", "beta_v0.1.onnx", *voice.WAKE_FEATURE_MODELS} <= basenames


def test_load_wake_model_missing_custom_path_is_actionable():
    """A bad custom path is reported even where openWakeWord is not installed."""
    with pytest.raises(RuntimeError, match="SPRYGEN_WAKE_MODEL"):
        voice.load_wake_model("/nonexistent/wake-model.onnx")


def test_load_wake_model_reports_offline_first_run(monkeypatch, tmp_path):
    """A failed download (offline first run) must not crash with a bare TypeError."""
    monkeypatch.setenv("SPRYGEN_VOICE_MODELS_DIR", str(tmp_path))
    monkeypatch.setattr(voice, "wake_model_dir", lambda: str(tmp_path))

    def _boom(*_args, **_kwargs):
        raise OSError("Name or service not known")

    _install_openwakeword_stub(monkeypatch, ["alpha"], download_file=_boom)

    with pytest.raises(RuntimeError, match="Could not download the openWakeWord models"):
        voice.load_wake_model("")


def test_load_wake_model_leaves_a_cached_dir_untouched(monkeypatch, tmp_path):
    """Every model already cached: loading must never hit the network."""
    monkeypatch.setattr(voice, "wake_model_dir", lambda: str(tmp_path))

    def _no_network(*_args, **_kwargs):
        raise AssertionError("must not download when every model is cached")

    captured: dict = {}

    class _FakeModel:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    _install_openwakeword_stub(
        monkeypatch, ["alpha"], model_factory=_FakeModel, download_file=_no_network
    )

    # Seed every file the loader expects, then load with the network disabled.
    for path in voice._wake_model_files(str(tmp_path)):
        with open(path, "wb") as handle:
            handle.write(b"cached")

    voice.load_wake_model("")

    assert captured["inference_framework"] == "onnx"
    wakeword_models = captured["wakeword_models"]
    basenames = {os.path.basename(path) for path in wakeword_models}
    assert "alpha_v0.1.onnx" in basenames
    # Feature models must never be handed to Model as wake words.
    assert not any(name in basenames for name in voice.WAKE_FEATURE_MODELS)


def test_download_wake_models_requests_onnx_and_tflite(monkeypatch, tmp_path):
    """Both variants are requested, mirroring openwakeword's own URL handling."""
    fetched: list[str] = []
    monkeypatch.setitem(
        sys.modules,
        "openwakeword",
        SimpleNamespace(
            MODELS=_fake_wake_models(["alpha"]),
            FEATURE_MODELS={"mel": {"download_url": "https://example.invalid/mel.tflite"}},
        ),
    )
    utils = ModuleType("openwakeword.utils")
    utils.download_file = lambda url, _dir: fetched.append(url.rsplit("/", 1)[-1])  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "openwakeword.utils", utils)

    voice._download_wake_models(str(tmp_path))

    assert {".tflite", ".onnx"} == {os.path.splitext(name)[1] for name in fetched}
    assert "alpha_v0.1.onnx" in fetched
    assert "mel.onnx" in fetched


def test_download_wake_models_skips_files_already_cached(monkeypatch, tmp_path):
    """A cached model must not be re-fetched (offline-safe after first run)."""
    (tmp_path / "alpha_v0.1.onnx").write_bytes(b"cached")
    fetched: list[str] = []
    monkeypatch.setitem(
        sys.modules, "openwakeword", SimpleNamespace(MODELS=_fake_wake_models(["alpha"]), FEATURE_MODELS={})
    )
    utils = ModuleType("openwakeword.utils")
    utils.download_file = lambda url, _dir: fetched.append(url.rsplit("/", 1)[-1])  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "openwakeword.utils", utils)

    voice._download_wake_models(str(tmp_path))

    assert "alpha_v0.1.onnx" not in fetched


def test_download_failure_message_names_the_model_dir(monkeypatch, tmp_path):
    monkeypatch.setitem(
        sys.modules, "openwakeword", SimpleNamespace(MODELS=_fake_wake_models(["alpha"]), FEATURE_MODELS={})
    )
    utils = ModuleType("openwakeword.utils")

    def _boom(*_args, **_kwargs):
        raise OSError("connection reset")

    utils.download_file = _boom  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "openwakeword.utils", utils)

    with pytest.raises(RuntimeError) as excinfo:
        voice._download_wake_models(str(tmp_path))

    assert str(tmp_path) in str(excinfo.value)
    assert "SPRYGEN_WAKE_MODEL" in str(excinfo.value)


def test_wake_phrases_reports_bundled_models(monkeypatch):
    fake = _fake_wake_models(["zulu", "alpha"])
    monkeypatch.setitem(sys.modules, "openwakeword", SimpleNamespace(MODELS=fake))
    assert voice.wake_phrases() == ["alpha", "zulu"]

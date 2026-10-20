"""Local, fully offline voice pipeline.

Everything runs on-device and nothing is uploaded:

* **capture** — ``sounddevice`` opens the microphone.
* **wake** — ``openwakeword`` scores 80 ms frames for the wake phrase.
* **stt** — ``faster-whisper`` transcribes the spoken command.
* **speaker** — ``resemblyzer`` produces a 256-dim speaker embedding; a cosine
  comparison against the enrolled voiceprint forms the speaker lock.
* **tts** — ``kokoro`` synthesises speech locally (no network).

The ML dependencies are *optional* and deliberately not imported at module load,
so the FastAPI app starts even when they are missing. When a component is not
installed the corresponding call fails **closed**: ``/api/voice/verify`` never
returns ``verified: true`` and enrollment never fabricates an embedding.

Install the local models with ``pip install -r backend/requirements-voice.txt``.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import queue
import threading
import wave
from typing import Any

log = logging.getLogger("sprygen.voice")

SAMPLE_RATE = 16000
FRAME_SAMPLES = 1280  # 80 ms @ 16 kHz — openWakeWord's frame size
DEFAULT_SAMPLE_SECONDS = 3.0
DEFAULT_COMMAND_SECONDS = 5.0
DEFAULT_THRESHOLD = 0.75
WAKE_THRESHOLD = 0.5
LEVEL_INTERVAL_SECONDS = 0.2  # throttle audio-level events to ~5/s

# capability key -> importable module name
_COMPONENT_MODULES: dict[str, str] = {
    "numpy": "numpy",
    "capture": "sounddevice",
    "wake": "openwakeword",
    "stt": "faster_whisper",
    "speaker": "resemblyzer",
    "tts": "kokoro",
}

_availability_cache: dict[str, bool] | None = None
_availability_lock = threading.Lock()


def _importable(module: str) -> bool:
    try:
        __import__(module)
        return True
    except Exception:  # noqa: BLE001 - any import failure means "not installed"
        return False


def availability() -> dict[str, bool]:
    """Return (and cache) which optional voice components are importable."""
    global _availability_cache
    with _availability_lock:
        if _availability_cache is None:
            _availability_cache = {key: _importable(mod) for key, mod in _COMPONENT_MODULES.items()}
        return dict(_availability_cache)


def reload_availability() -> None:
    global _availability_cache
    with _availability_lock:
        _availability_cache = None


def _capture_ready() -> bool:
    caps = availability()
    return bool(caps.get("capture") and caps.get("numpy"))


def _speaker_ready() -> bool:
    caps = availability()
    return bool(caps.get("speaker") and caps.get("capture") and caps.get("numpy"))


def _stt_ready() -> bool:
    return bool(availability().get("stt"))


def _tts_available() -> bool:
    return bool(availability().get("tts"))


# ---------------------------------------------------------------------------
# Wake-word models
#
# openWakeWord does NOT auto-download its models, and its default target
# directory lives inside site-packages — which, in a packaged (PyInstaller)
# build, is an ephemeral per-launch extraction folder. Point it at a persistent
# per-user cache instead.
# ---------------------------------------------------------------------------
WAKE_FEATURE_MODELS = ("melspectrogram.onnx", "embedding_model.onnx")


def wake_model_dir() -> str:
    """Directory that caches the openWakeWord ONNX models between launches."""
    override = os.getenv("SPRYGEN_VOICE_MODELS_DIR", "").strip()
    if override:
        return override
    return os.path.join(os.path.expanduser("~"), ".sprygen", "voice-models")


def _wake_model_files(model_dir: str) -> list[str]:
    """Expected ONNX paths for every bundled wake model (in ``openwakeword.MODELS``)."""
    import openwakeword

    files = [
        os.path.join(model_dir, info["download_url"].rsplit("/", 1)[-1].replace(".tflite", ".onnx"))
        for info in openwakeword.MODELS.values()
    ]
    files += [os.path.join(model_dir, name) for name in WAKE_FEATURE_MODELS]
    return files


def _download_wake_models(model_dir: str) -> None:
    """Fetch the ONNX wake + feature models missing from ``model_dir``.

    openWakeWord ships its weights as GitHub release assets; ONNX builds are
    derived from the published ``.tflite`` URLs by swapping the extension, the
    same convention ``openwakeword.utils.download_models`` relies on. Both
    variants are requested so the directory matches what upstream expects.
    """
    import openwakeword
    from openwakeword.utils import download_file

    urls: list[str] = [
        info["download_url"]
        for info in (*openwakeword.FEATURE_MODELS.values(), *openwakeword.MODELS.values())
    ]
    urls += [url.replace(".tflite", ".onnx") for url in list(urls)]

    try:
        for url in urls:
            name = url.rsplit("/", 1)[-1]
            if os.path.exists(os.path.join(model_dir, name)):
                continue
            download_file(url, model_dir)
    except Exception as exc:  # noqa: BLE001 - any failure means "cannot fetch"
        raise RuntimeError(
            f"Could not download the openWakeWord models into {model_dir} "
            f"({exc}). They are fetched once on first use; connect to the "
            "internet, or set SPRYGEN_WAKE_MODEL to a local .onnx model."
        ) from exc


def load_wake_model(model_path: str = "") -> Any:
    """Build the openWakeWord engine, downloading bundled models on first use.

    ``model_path`` may point at a custom ONNX model; blank loads every bundled
    pre-trained phrase. Models are fetched once into :func:`wake_model_dir` and
    reused. Raises a descriptive error when the download fails (offline first
    run) so the caller can surface it instead of crashing silently.
    """
    # Validate the custom path before importing the engine so a misconfigured
    # SPRYGEN_WAKE_MODEL reports the real problem even where openWakeWord is
    # not installed.
    if model_path and not os.path.isfile(model_path):
        raise RuntimeError(f"SPRYGEN_WAKE_MODEL points at {model_path}, which does not exist.")

    from openwakeword.model import Model

    if model_path:
        return Model(wakeword_models=[model_path], inference_framework="onnx")

    model_dir = wake_model_dir()
    os.makedirs(model_dir, exist_ok=True)

    # `openwakeword.utils.download_models` skips its ONNX downloads whenever the
    # corresponding .tflite file is already present (upstream quirk: the guard
    # checks the .tflite name but fetches both). If a previous run was cut short
    # that leaves us with only the .tflite half, so drive the download per file
    # instead of trusting its "already exists" shortcut.
    expected = _wake_model_files(model_dir)
    missing = [path for path in expected if not os.path.exists(path)]
    if missing:
        _download_wake_models(model_dir)

    still_missing = [path for path in expected if not os.path.exists(path)]
    if still_missing:
        raise RuntimeError(
            "openWakeWord models are incomplete in "
            f"{model_dir} (missing: {', '.join(os.path.basename(p) for p in still_missing)}). "
            "Delete the folder and retry with internet access."
        )

    wake_files = [
        path
        for path in expected
        if path.endswith(".onnx") and not path.endswith(WAKE_FEATURE_MODELS)
    ]
    return Model(
        wakeword_models=wake_files,
        inference_framework="onnx",
        melspec_model_path=os.path.join(model_dir, "melspectrogram.onnx"),
        embedding_model_path=os.path.join(model_dir, "embedding_model.onnx"),
    )


def wake_phrases() -> list[str]:
    """Names of the bundled wake models, for the settings UI."""
    try:
        import openwakeword

        return sorted(openwakeword.MODELS.keys())
    except Exception:  # noqa: BLE001
        return []


# ---------------------------------------------------------------------------
# Model singletons (loaded lazily on first use, then reused)
# ---------------------------------------------------------------------------
_encoder: Any = None
_encoder_lock = threading.Lock()
_transcriber: Any = None
_transcriber_lock = threading.Lock()
_tts_pipeline: Any = None
_tts_lock = threading.Lock()


def _voice_encoder():
    global _encoder
    if _encoder is None:
        with _encoder_lock:
            if _encoder is None:
                from resemblyzer import VoiceEncoder

                _encoder = VoiceEncoder()
    return _encoder


def _whisper():
    global _transcriber
    if _transcriber is None:
        with _transcriber_lock:
            if _transcriber is None:
                from faster_whisper import WhisperModel

                model = os.getenv("SPRYGEN_WHISPER_MODEL", "base.en")
                device = os.getenv("SPRYGEN_WHISPER_DEVICE", "cpu")
                _transcriber = WhisperModel(model, device=device, compute_type="int8")
    return _transcriber


def _kokoro():
    global _tts_pipeline
    if _tts_pipeline is None:
        with _tts_lock:
            if _tts_pipeline is None:
                from kokoro import KPipeline

                _tts_pipeline = KPipeline(lang_code=os.getenv("SPRYGEN_TTS_LANG", "a"))
    return _tts_pipeline


# ---------------------------------------------------------------------------
# Low-level primitives
# ---------------------------------------------------------------------------
def record(seconds: float = DEFAULT_SAMPLE_SECONDS) -> Any:
    """Capture ``seconds`` of mono float32 audio at 16 kHz."""
    import numpy as np
    import sounddevice as sd

    frames = max(1, int(seconds * SAMPLE_RATE))
    audio = sd.rec(frames, samplerate=SAMPLE_RATE, channels=1, dtype="float32")
    sd.wait()
    return np.asarray(audio, dtype="float32").reshape(-1)


def embed(audio: Any) -> list[float]:
    """Return the Resemblyzer speaker embedding for a mono audio buffer."""
    import numpy as np

    vector = _voice_encoder().embed_utterance(np.asarray(audio, dtype="float32"))
    return [float(x) for x in vector]


def cosine(a: list[float], b: list[float]) -> float:
    import math

    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def _effective(seconds: float | None, default: float) -> float:
    try:
        value = float(seconds) if seconds is not None else default
    except (TypeError, ValueError):
        value = default
    return max(0.5, min(value, 30.0))


# ---------------------------------------------------------------------------
# Capability endpoints (all fail closed)
# ---------------------------------------------------------------------------
def status() -> dict:
    caps = availability()
    components = {
        "capture": caps.get("capture", False) and caps.get("numpy", False),
        "wake": caps.get("wake", False),
        "stt": caps.get("stt", False),
        "speaker": caps.get("speaker", False),
        "tts": caps.get("tts", False),
    }
    return {
        "ok": True,
        "running": _loop_running(),
        "sampleRate": SAMPLE_RATE,
        "components": components,
        # Surfaced so the desktop UI can tell the user exactly what to install.
        "missing": [name for name, ready in components.items() if not ready],
        # The bundled openWakeWord models are what the engine actually listens
        # for; SPRYGEN_WAKE_MODEL may swap in a custom one.
        "wakeModels": wake_phrases() if components["wake"] else [],
        "modelDir": wake_model_dir(),
    }


def sample(seconds: float = DEFAULT_SAMPLE_SECONDS) -> dict:
    """Record a clip and return a real speaker embedding (for enrollment)."""
    if not availability().get("speaker", False) or not availability().get("capture", False):
        return {
            "ok": False,
            "code": "speaker_unavailable",
            "message": "Resemblyzer/sounddevice are not installed",
        }
    try:
        audio = record(_effective(seconds, DEFAULT_SAMPLE_SECONDS))
        return {"ok": True, "embedding": embed(audio)}
    except Exception as exc:  # noqa: BLE001
        log.exception("voice sample failed")
        return {"ok": False, "code": "sample_failed", "message": str(exc)}


def verify_sample(
    reference: list[float] | None,
    seconds: float = DEFAULT_SAMPLE_SECONDS,
    threshold: float = DEFAULT_THRESHOLD,
) -> dict:
    """Compare a fresh recording against the enrolled voiceprint.

    Fails closed: any missing dependency or error yields
    ``verified: False``.
    """
    ref = [float(x) for x in (reference or [])]
    if not ref:
        return {
            "ok": False,
            "code": "no_reference",
            "verified": False,
            "score": 0.0,
            "message": "No enrolled voiceprint supplied",
        }
    if not availability().get("speaker", False) or not availability().get("capture", False):
        return {
            "ok": False,
            "code": "speaker_unavailable",
            "verified": False,
            "score": 0.0,
            "message": "Resemblyzer/sounddevice are not installed",
        }
    try:
        audio = record(_effective(seconds, DEFAULT_SAMPLE_SECONDS))
        score = cosine(ref, embed(audio))
        return {"ok": True, "verified": score >= float(threshold), "score": score}
    except Exception as exc:  # noqa: BLE001
        log.exception("speaker verification failed")
        return {
            "ok": False,
            "code": "verify_failed",
            "verified": False,
            "score": 0.0,
            "message": str(exc),
        }


def transcribe_sample(seconds: float = DEFAULT_COMMAND_SECONDS) -> dict:
    if not availability().get("stt", False) or not availability().get("capture", False):
        return {
            "ok": False,
            "code": "stt_unavailable",
            "message": "faster-whisper/sounddevice are not installed",
        }
    try:
        audio = record(_effective(seconds, DEFAULT_COMMAND_SECONDS))
        return {"ok": True, "text": _transcribe(audio)}
    except Exception as exc:  # noqa: BLE001
        log.exception("transcription failed")
        return {"ok": False, "code": "transcribe_failed", "message": str(exc)}


def _transcribe(audio: Any) -> str:
    segments, _info = _whisper().transcribe(audio, language=os.getenv("SPRYGEN_STT_LANG", "en"))
    return " ".join(segment.text.strip() for segment in segments).strip()


def synthesize(text: str) -> dict:
    """Synthesise ``text`` locally with Kokoro and return base64 WAV audio."""
    if not text or not text.strip():
        return {"ok": False, "code": "empty_text", "message": "No text supplied"}
    if not availability().get("tts", False):
        return {"ok": False, "code": "tts_unavailable", "message": "Kokoro TTS is not installed"}
    try:
        wav_bytes = _synthesize_wav(text.strip())
        return {
            "ok": True,
            "format": "wav",
            "sampleRate": int(os.getenv("SPRYGEN_TTS_SAMPLE_RATE", "24000")),
            "audioBase64": base64.b64encode(wav_bytes).decode("ascii"),
        }
    except Exception as exc:  # noqa: BLE001
        log.exception("synthesis failed")
        return {"ok": False, "code": "tts_failed", "message": str(exc)}


def _synthesize_wav(text: str) -> bytes:
    import numpy as np

    voice = os.getenv("SPRYGEN_TTS_VOICE", "af_heart")
    chunks = [np.asarray(audio, dtype="float32") for _gs, _ps, audio in _kokoro()(text, voice=voice)]
    chunks = [c for c in chunks if c.size]
    if not chunks:
        raise RuntimeError("Kokoro produced no audio")
    samples = np.concatenate(chunks)
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(int(os.getenv("SPRYGEN_TTS_SAMPLE_RATE", "24000")))
        wav.writeframes(pcm.tobytes())
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# Continuous wake-word loop
# ---------------------------------------------------------------------------
class _VoiceLoop(threading.Thread):
    def __init__(self, reference: list[float], threshold: float) -> None:
        super().__init__(daemon=True, name="sprygen-voice-loop")
        self.reference = [float(x) for x in (reference or [])]
        self.threshold = float(threshold)
        self._stop = threading.Event()
        self.events: "queue.Queue[dict]" = queue.Queue(maxsize=256)
        self._last_level = 0.0

    def stop(self) -> None:
        self._stop.set()

    def emit(self, event: dict) -> None:
        try:
            self.events.put_nowait(event)
        except queue.Full:
            pass

    def _emit_level(self, level: float) -> None:
        import time

        now = time.monotonic()
        if now - self._last_level >= LEVEL_INTERVAL_SECONDS:
            self._last_level = now
            self.emit({"type": "audio-level", "level": round(level, 4)})

    def run(self) -> None:
        try:
            import numpy as np
            import sounddevice as sd

            model_path = os.getenv("SPRYGEN_WAKE_MODEL", "").strip()
            wakeword = load_wake_model(model_path)
            with sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=1,
                dtype="int16",
                blocksize=FRAME_SAMPLES,
            ) as stream:
                while not self._stop.is_set():
                    frame, _overflow = stream.read(FRAME_SAMPLES)
                    data = np.asarray(frame).reshape(FRAME_SAMPLES, -1)
                    mono = data[:, 0]
                    predictions = wakeword.predict(mono)
                    score = max((float(v) for v in predictions.values()), default=0.0)
                    self._emit_level(float(np.abs(mono).mean()) / 32768.0)
                    if score < WAKE_THRESHOLD:
                        continue
                    self.emit({"type": "wake", "score": score})
                    command = record(DEFAULT_COMMAND_SECONDS)
                    if self.reference:
                        try:
                            similarity = cosine(self.reference, embed(command))
                        except Exception as exc:  # noqa: BLE001
                            self.emit({"type": "error", "message": str(exc)})
                            continue
                        if similarity < self.threshold:
                            self.emit({"type": "denied", "score": similarity})
                            continue
                    try:
                        text = _transcribe(command)
                    except Exception as exc:  # noqa: BLE001
                        self.emit({"type": "error", "message": str(exc)})
                        continue
                    if text.strip():
                        self.emit({"type": "transcript", "text": text.strip()})
        except Exception as exc:  # noqa: BLE001
            log.exception("voice loop crashed")
            self.emit({"type": "error", "message": str(exc)})


_loop: _VoiceLoop | None = None
_loop_lock = threading.Lock()


def _loop_running() -> bool:
    return bool(_loop is not None and _loop.is_alive())


def start(reference: list[float] | None = None, threshold: float = DEFAULT_THRESHOLD) -> dict:
    """Start the continuous wake-word loop with an optional speaker lock."""
    global _loop
    caps = availability()
    # The loop is useless without transcription, so `stt` is required too.
    required = ("capture", "wake", "numpy", "stt")
    missing = [name for name in required if not caps.get(name, False)]
    if missing:
        return {
            "ok": False,
            "code": "unavailable",
            "message": (
                f"Voice engine components not installed: {', '.join(missing)}. "
                "Install the offline voice stack with "
                "`pip install -r backend/requirements-voice-core.txt` "
                "(packaged builds ship it already)."
            ),
        }
    with _loop_lock:
        if _loop is not None and _loop.is_alive():
            _loop.stop()
        _loop = _VoiceLoop(list(reference or []), threshold)
        _loop.start()
    return {"ok": True}


def stop() -> dict:
    global _loop
    with _loop_lock:
        if _loop is not None:
            _loop.stop()
            _loop = None
    return {"ok": True}


def drain_events() -> dict:
    """Return and clear any events produced by the wake-word loop."""
    loop = _loop
    if loop is None:
        return {"ok": True, "events": []}
    events: list[dict] = []
    while True:
        try:
            events.append(loop.events.get_nowait())
        except queue.Empty:
            break
    return {"ok": True, "events": events}

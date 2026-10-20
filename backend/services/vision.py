"""Local screen understanding via an Ollama vision model (llava-class).

The screen frame is captured by Electron (``desktopCapturer``) and sent here as
base64 PNG. This module forwards it to the locally hosted Ollama daemon — no
image ever leaves the machine. When Ollama or the vision model is missing the
call fails closed with a descriptive ``code``.
"""

from __future__ import annotations

import os

import httpx


def _ollama_url() -> str:
    return (os.getenv("SPRYGEN_OLLAMA_URL") or "http://127.0.0.1:11434").rstrip("/")


def describe_image(image_base64: str, prompt: str = "") -> dict:
    """Send a base64 PNG to the local Ollama vision model and return its text."""
    if not image_base64:
        return {"ok": False, "code": "no_image", "error": "No screen image supplied"}

    model = os.getenv("SPRYGEN_VISION_MODEL", "llava")
    payload = {
        "model": model,
        "prompt": (prompt or "Describe what is on the screen.").strip(),
        "images": [image_base64],
        "stream": False,
    }
    url = f"{_ollama_url()}/api/generate"
    try:
        response = httpx.post(url, json=payload, timeout=120.0)
    except Exception as exc:  # noqa: BLE001 - connection refused / timeout
        return {
            "ok": False,
            "code": "vision_unreachable",
            "error": (
                f"Ollama is not reachable at {_ollama_url()} ({exc}). "
                "Screen capture needs a local Ollama vision model: install Ollama "
                "from https://ollama.com, run `ollama pull "
                f"{model}`, then try again."
            ),
        }
    if response.status_code != 200:
        detail = ""
        try:
            detail = str(response.json().get("error", "") or "").strip()
        except Exception:  # noqa: BLE001 - non-JSON body
            detail = ""
        hint = f" Run `ollama pull {model}` if the model is not installed." if response.status_code in (404, 500) else ""
        return {
            "ok": False,
            "code": f"vision_http_{response.status_code}",
            "error": f"Ollama returned {response.status_code}"
            + (f": {detail}" if detail else "")
            + hint,
        }
    try:
        body = response.json()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "code": "vision_bad_response", "error": str(exc)}
    description = str(body.get("response", "")).strip()
    if not description:
        return {
            "ok": False,
            "code": "vision_empty",
            "error": f"Model '{model}' returned no description. Try `ollama pull {model}`.",
        }
    return {"ok": True, "description": description, "model": model}

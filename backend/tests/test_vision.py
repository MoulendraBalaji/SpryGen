"""Local vision (Ollama) client: fail-closed behaviour and response handling."""

from __future__ import annotations

from backend.services import vision


class _Resp:
    def __init__(self, status_code: int, payload: dict | None = None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self) -> dict:
        return self._payload


def test_unreachable_ollama_fails_closed(monkeypatch):
    def boom(*_a, **_k):
        raise ConnectionError("connection refused")

    monkeypatch.setattr(vision.httpx, "post", boom)
    result = vision.describe_image("AAAA", "what is this?")
    assert result["ok"] is False
    assert result["code"] == "vision_unreachable"


def test_http_error_fails_closed(monkeypatch):
    monkeypatch.setattr(vision.httpx, "post", lambda *_a, **_k: _Resp(500))
    result = vision.describe_image("AAAA", "describe")
    assert result["ok"] is False
    assert result["code"] == "vision_http_500"


def test_empty_response_fails_closed(monkeypatch):
    monkeypatch.setattr(vision.httpx, "post", lambda *_a, **_k: _Resp(200, {"response": "   "}))
    result = vision.describe_image("AAAA", "describe")
    assert result["ok"] is False
    assert result["code"] == "vision_empty"


def test_successful_description(monkeypatch):
    monkeypatch.setattr(
        vision.httpx, "post", lambda *_a, **_k: _Resp(200, {"response": "A web browser."})
    )
    result = vision.describe_image("AAAA", "describe")
    assert result["ok"] is True
    assert result["description"] == "A web browser."


def test_empty_image_rejected(monkeypatch):
    result = vision.describe_image("", "describe")
    assert result["ok"] is False
    assert result["code"] == "no_image"

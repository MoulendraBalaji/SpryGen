"""Phase 3 trust-boundary tests: bearer token, Host allowlist, Origin rejection.

The backend reads its launch config (host/port/token) from the environment at
import time, so this module sets the env and imports/reloads the app inside the
fixture.
"""

from __future__ import annotations

import importlib
import os

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

TOKEN = "test-launch-token"
PORT = 8766
BASE_URL = f"http://127.0.0.1:{PORT}"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(scope="module")
def client():
    os.environ["SPRYGEN_HOST"] = "127.0.0.1"
    os.environ["SPRYGEN_PORT"] = str(PORT)
    os.environ["SPRYGEN_TOKEN"] = TOKEN

    import backend.config as config

    importlib.reload(config)
    import backend.server as server

    importlib.reload(server)

    with TestClient(server.app, base_url=BASE_URL) as c:
        yield c


def test_health_requires_token(client):
    resp = client.get("/health")
    assert resp.status_code == 401
    assert resp.json()["code"] == "unauthorized"


def test_health_rejects_wrong_token(client):
    resp = client.get("/health", headers={"Authorization": "Bearer nope"})
    assert resp.status_code == 401


def test_health_accepts_valid_token(client):
    resp = client.get("/health", headers=AUTH)
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_rejects_foreign_origin(client):
    resp = client.get("/health", headers={**AUTH, "Origin": "http://evil.example"})
    assert resp.status_code == 403
    assert resp.json()["code"] == "forbidden_origin"


def test_rejects_unexpected_host(client):
    resp = client.get("/health", headers={**AUTH, "Host": "evil.example:80"})
    assert resp.status_code == 400
    assert resp.json()["code"] == "bad_host"


def test_ws_requires_token(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws") as ws:
            ws.receive_text()


def test_ws_rejects_foreign_origin(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws", headers={"Origin": "http://evil.com"}) as ws:
            ws.receive_text()

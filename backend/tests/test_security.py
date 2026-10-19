"""Phase 8 security checks (backend + sync server).

Covers:
- Authorization trust boundary (401 without token, origin/host checks)
- SSRF rejection for blocked URLs via /api/automation/web-scrape
- Sync server (Node/TS deviceSync): status has no pairing code, capture without
  device token returns 401, six wrong PINs trigger lockout.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
from starlette.testclient import TestClient

TOKEN = "test-launch-token"
PORT = 8767
BASE_URL = f"http://127.0.0.1:{PORT}"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(scope="module")
def client():
    os.environ["SPRYGEN_HOST"] = "127.0.0.1"
    os.environ["SPRYGEN_PORT"] = str(PORT)
    os.environ["SPRYGEN_TOKEN"] = TOKEN

    import importlib

    import backend.config as config

    importlib.reload(config)
    import backend.server as server

    importlib.reload(server)

    with TestClient(server.app, base_url=BASE_URL) as c:
        yield c


def test_no_authorization_header_401(client):
    resp = client.get("/health")
    assert resp.status_code == 401


def test_foreign_origin_with_token_not_allowed(client):
    resp = client.get("/health", headers={"Authorization": TOKEN, "Origin": "https://evil.example"})
    assert resp.status_code == 403
    assert "access-control-allow-origin" not in {k.lower(): v for k, v in resp.headers.items()}


def test_options_preflight_from_foreign_origin_not_200(client):
    resp = client.options(
        "/health",
        headers={"Authorization": TOKEN, "Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert resp.status_code != 200
    assert "access-control-allow-origin" not in {k.lower(): v for k, v in resp.headers.items()}


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://127.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.1/",
    ],
)
def test_web_scrape_rejected_for_blocked_urls(client, url):
    resp = client.post("/api/automation/web-scrape", json={"url": url, "selector": ""}, headers=AUTH)
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("ok") is False
    err = body.get("error") or {}
    code = str(err.get("code") or "").upper()
    assert code in {"BAD_URL", "BLOCKED_SCHEME", "BLOCKED_HOST", "DNS_FAILED"}, err
    assert err.get("message")


def test_sync_server_security_assertions():
    repo_root = Path(__file__).resolve().parents[2]
    script_path = repo_root / "scripts" / "sync-security-check.mjs"

    if not script_path.exists():
        pytest.skip("sync-security-check.mjs not found")

    try:
        result = subprocess.run(
            ["node", str(script_path)],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            timeout=120,
        )
    except FileNotFoundError:
        pytest.skip("node not available")
    except subprocess.TimeoutExpired as exc:
        raise AssertionError(f"sync-security-check timed out: {exc}") from exc

    if result.returncode != 0:
        raise AssertionError(f"sync-security-check failed:\nSTDOUT:{result.stdout}\nSTDERR:{result.stderr}")

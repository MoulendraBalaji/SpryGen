"""SSRF-guard tests: scheme allowlist and private/loopback/link-local blocking."""

from __future__ import annotations

import socket

import pytest

from backend.services import netguard
from backend.services.netguard import SSRFError, assert_public_url


def _addrinfo(*ips: str):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 80)) for ip in ips]


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://localhost/",
        "http://10.0.0.5/",
        "http://192.168.1.10/",
        "http://172.16.0.9/",
        "http://169.254.169.254/latest/meta-data/",  # cloud metadata endpoint
        "http://0.0.0.0/",
        "http://[::1]/",
    ],
)
def test_blocks_non_public_literals(url):
    with pytest.raises(SSRFError):
        assert_public_url(url)


@pytest.mark.parametrize(
    "url",
    ["ftp://example.com/file", "file:///etc/passwd", "javascript:alert(1)", "", "   "],
)
def test_blocks_bad_schemes(url):
    with pytest.raises(SSRFError):
        assert_public_url(url)


def test_accepts_public_literal():
    assert assert_public_url("https://1.1.1.1/") == "https://1.1.1.1/"


def test_accepts_public_hostname(monkeypatch):
    monkeypatch.setattr(netguard.socket, "getaddrinfo", lambda *a, **k: _addrinfo("93.184.216.34"))
    assert assert_public_url("http://example.com/") == "http://example.com/"


def test_blocks_hostname_resolving_to_loopback(monkeypatch):
    monkeypatch.setattr(netguard.socket, "getaddrinfo", lambda *a, **k: _addrinfo("127.0.0.1"))
    with pytest.raises(SSRFError):
        assert_public_url("http://hidden.internal/")


def test_blocks_when_any_resolved_address_is_private(monkeypatch):
    monkeypatch.setattr(netguard.socket, "getaddrinfo", lambda *a, **k: _addrinfo("93.184.216.34", "10.0.0.1"))
    with pytest.raises(SSRFError):
        assert_public_url("http://rebind.example/")


def test_blocks_unresolvable_hostname(monkeypatch):
    def boom(*a, **k):
        raise socket.gaierror("no such host")

    monkeypatch.setattr(netguard.socket, "getaddrinfo", boom)
    with pytest.raises(SSRFError):
        assert_public_url("http://does-not-exist.example/")

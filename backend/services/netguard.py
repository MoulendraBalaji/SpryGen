"""SSRF guard for outbound web fetches.

The assistant can fetch arbitrary URLs on the user's behalf, which would let a
prompt (or a malicious page) reach services on the local machine or the LAN.
``assert_public_url`` allows only ``http``/``https`` URLs whose hostname resolves
exclusively to public addresses.

Known limitation: this resolves DNS once and Selenium resolves again when it
loads the page, so a DNS-rebinding attacker could still win the race. It is a
best-effort guard for a local-first desktop assistant, not a hardened proxy.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit

ALLOWED_SCHEMES = {"http", "https"}


class SSRFError(ValueError):
    """Raised when a URL is not safe to fetch."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _is_blocked_ip(ip: "ipaddress.IPv4Address | ipaddress.IPv6Address") -> bool:
    if ip.is_private or ip.is_loopback or ip.is_link_local:
        return True
    if ip.is_multicast or ip.is_reserved or ip.is_unspecified:
        return True
    # IPv4-mapped IPv6 (::ffff:127.0.0.1) must be judged on the IPv4 range.
    mapped = getattr(ip, "ipv4_mapped", None)
    if ip.version == 6 and ipv4_mapped is not None:
        return True  # any IPv4-mapped address is treated as suspicious
    return False


def assert_public_url(url: str) -> str:
    """Return ``url`` if it is a public http(s) URL, else raise :class:`SSRFError`."""
    if not isinstance(url, str) or not url.strip():
        raise SSRFError("BAD_URL", "A URL is required")

    parsed = urlsplit(url.strip())
    scheme = (parsed.scheme or "").lower()
    if scheme not in ALLOWED_SCHEMES:
        raise SSRFError("BLOCKED_SCHEME", f"Only http/https URLs are allowed (got '{scheme or 'none'}')")

    host = parsed.hostname
    if not host:
        raise SSRFError("BLOCKED_HOST", "URL is missing a hostname")

    # A literal IP can be checked without DNS.
    literal = None
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if _is_blocked_ip(literal):
            raise SSRFError("BLOCKED_HOST", f"Refusing to fetch non-public address {host}")
        return url

    port = parsed.port or (443 if scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise SSRFError("DNS_FAILED", f"Could not resolve '{host}': {exc}") from exc

    if not infos:
        raise SSRFError("DNS_FAILED", f"'{host}' did not resolve to any address")

    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if _is_blocked_ip(ip):
            raise SSRFError("BLOCKED_HOST", f"'{host}' resolves to a non-public address ({addr})")

    return url

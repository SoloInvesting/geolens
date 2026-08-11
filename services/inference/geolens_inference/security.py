from __future__ import annotations

import ipaddress
import secrets
from collections.abc import Iterable
from urllib.parse import urlsplit

from fastapi import HTTPException, status


def require_bearer(authorization: str | None, configured_token: str | None) -> None:
    """Require a constant-time Bearer comparison only when a token is configured."""
    if configured_token is None:
        return
    scheme, separator, supplied = (authorization or "").partition(" ")
    if separator != " " or scheme.lower() != "bearer" or not supplied:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid Bearer token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not secrets.compare_digest(supplied.encode("utf-8"), configured_token.encode("utf-8")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid Bearer token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _canonical_host(hostname: str) -> str:
    try:
        return hostname.encode("idna").decode("ascii").lower().rstrip(".")
    except UnicodeError as exc:
        raise ValueError("URL contains an invalid hostname.") from exc


def _host_matches(hostname: str, patterns: Iterable[str]) -> bool:
    for raw_pattern in patterns:
        pattern = raw_pattern.lower().rstrip(".")
        if pattern.startswith("*."):
            suffix = pattern[1:]
            if hostname.endswith(suffix) and hostname != suffix[1:]:
                return True
        elif hostname == pattern:
            return True
    return False


def validate_remote_url(
    raw_url: str,
    *,
    allowed_hosts: Iterable[str],
    allow_private_hosts: bool,
    label: str,
) -> None:
    """Reject non-HTTPS, credentialed, non-allowlisted and private remote URLs."""
    try:
        parsed = urlsplit(raw_url)
        port = parsed.port
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{label} contains an invalid URL.") from exc
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise HTTPException(status_code=422, detail=f"{label} must use HTTPS.")
    if parsed.username is not None or parsed.password is not None:
        raise HTTPException(status_code=422, detail=f"{label} must not contain URL credentials.")
    if parsed.fragment:
        raise HTTPException(status_code=422, detail=f"{label} must not contain a URL fragment.")
    if port not in (None, 443):
        raise HTTPException(status_code=422, detail=f"{label} must use the standard HTTPS port.")

    try:
        hostname = _canonical_host(parsed.hostname)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{label} contains an invalid hostname.") from exc
    try:
        address = ipaddress.ip_address(hostname.strip("[]"))
    except ValueError:
        address = None
    if address and not allow_private_hosts and not address.is_global:
        raise HTTPException(status_code=422, detail=f"{label} points to a non-public IP address.")
    if not _host_matches(hostname, allowed_hosts):
        raise HTTPException(status_code=422, detail=f"{label} host is not on the configured allowlist.")

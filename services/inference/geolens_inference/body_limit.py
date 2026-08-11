from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any


Scope = dict[str, Any]
Message = dict[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
AsgiApp = Callable[[Scope, Receive, Send], Awaitable[None]]


async def _json_error(send: Send, status_code: int, detail: str) -> None:
    body = json.dumps({"detail": detail}, separators=(",", ":")).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status_code,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body, "more_body": False})


def _declared_content_length(scope: Scope) -> int | None:
    raw_values = [
        value.decode("latin-1").strip()
        for name, value in scope.get("headers", [])
        if name.lower() == b"content-length"
    ]
    if not raw_values:
        return None
    if len(raw_values) != 1 or len(raw_values[0]) > 20 or not raw_values[0].isdigit():
        raise ValueError("Invalid Content-Length header.")
    return int(raw_values[0])


class RequestBodyLimitMiddleware:
    """Bound a request body even when Content-Length is absent or dishonest."""

    def __init__(self, app: AsgiApp, *, max_bytes: int, path: str = "/v1/infer") -> None:
        if max_bytes < 1:
            raise ValueError("max_bytes must be positive.")
        self._app = app
        self._max_bytes = max_bytes
        self._path = path

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http" or scope.get("path") != self._path:
            await self._app(scope, receive, send)
            return

        try:
            declared_size = _declared_content_length(scope)
        except ValueError:
            await _json_error(send, 400, "Invalid Content-Length header.")
            return
        if declared_size is not None and declared_size > self._max_bytes:
            await _json_error(send, 413, "Request body exceeds the configured limit.")
            return

        body = bytearray()
        received_size = 0
        while True:
            message = await receive()
            message_type = message.get("type")
            if message_type == "http.disconnect":
                await _json_error(send, 400, "Client disconnected before the request body was complete.")
                return
            if message_type != "http.request":
                continue
            chunk = message.get("body", b"")
            received_size += len(chunk)
            if received_size > self._max_bytes:
                await _json_error(send, 413, "Request body exceeds the configured limit.")
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break

        buffered_body = bytes(body)
        delivered = False

        async def replay_receive() -> Message:
            nonlocal delivered
            if delivered:
                return {"type": "http.disconnect"}
            delivered = True
            return {"type": "http.request", "body": buffered_body, "more_body": False}

        await self._app(scope, replay_receive, send)

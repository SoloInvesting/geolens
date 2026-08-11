from __future__ import annotations

import asyncio
import json
from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from geolens_inference.body_limit import RequestBodyLimitMiddleware  # noqa: E402


def _scope(headers: list[tuple[bytes, bytes]] | None = None) -> dict:
    return {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/v1/infer",
        "raw_path": b"/v1/infer",
        "query_string": b"",
        "headers": headers or [],
        "client": ("127.0.0.1", 1234),
        "server": ("test", 80),
    }


def test_chunked_body_without_content_length_is_bounded() -> None:
    async def scenario() -> None:
        downstream_called = False

        async def downstream(scope, receive, send) -> None:
            del scope, receive, send
            nonlocal downstream_called
            downstream_called = True

        messages = iter(
            [
                {"type": "http.request", "body": b"1234", "more_body": True},
                {"type": "http.request", "body": b"5678", "more_body": False},
            ]
        )
        sent: list[dict] = []

        async def receive() -> dict:
            return next(messages)

        async def send(message: dict) -> None:
            sent.append(message)

        middleware = RequestBodyLimitMiddleware(downstream, max_bytes=7)
        await middleware(_scope(), receive, send)

        assert downstream_called is False
        assert sent[0]["status"] == 413
        assert json.loads(sent[1]["body"])["detail"] == "Request body exceeds the configured limit."

    asyncio.run(scenario())


def test_body_within_limit_is_replayed_to_downstream() -> None:
    async def scenario() -> None:
        received_body = b""

        async def downstream(scope, receive, send) -> None:
            del scope
            nonlocal received_body
            message = await receive()
            received_body = message["body"]
            await send({"type": "http.response.start", "status": 204, "headers": []})
            await send({"type": "http.response.body", "body": b"", "more_body": False})

        messages = iter(
            [
                {"type": "http.request", "body": b"1234", "more_body": True},
                {"type": "http.request", "body": b"56", "more_body": False},
            ]
        )
        sent: list[dict] = []

        async def receive() -> dict:
            return next(messages)

        async def send(message: dict) -> None:
            sent.append(message)

        middleware = RequestBodyLimitMiddleware(downstream, max_bytes=6)
        await middleware(_scope(), receive, send)

        assert received_body == b"123456"
        assert sent[0]["status"] == 204

    asyncio.run(scenario())


def test_conflicting_content_length_headers_are_rejected() -> None:
    async def scenario() -> None:
        downstream_called = False

        async def downstream(scope, receive, send) -> None:
            del scope, receive, send
            nonlocal downstream_called
            downstream_called = True

        async def receive() -> dict:
            return {"type": "http.request", "body": b"1234", "more_body": False}

        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        middleware = RequestBodyLimitMiddleware(downstream, max_bytes=10)
        await middleware(
            _scope([(b"content-length", b"4"), (b"content-length", b"5")]),
            receive,
            send,
        )

        assert downstream_called is False
        assert sent[0]["status"] == 400

    asyncio.run(scenario())

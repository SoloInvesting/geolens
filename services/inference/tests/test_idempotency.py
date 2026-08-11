from __future__ import annotations

import asyncio
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from geolens_inference.idempotency import IdempotencyConflict, IdempotencyStore  # noqa: E402


def test_concurrent_retries_share_one_producer() -> None:
    async def scenario() -> None:
        calls = 0
        store: IdempotencyStore[str] = IdempotencyStore(ttl_seconds=60, max_entries=8)

        async def producer() -> str:
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.01)
            return "result"

        first, second = await asyncio.gather(
            store.execute(key="request-1", fingerprint="body-a", producer=producer),
            store.execute(key="request-1", fingerprint="body-a", producer=producer),
        )
        assert calls == 1
        assert first[0] == second[0] == "result"
        assert {first[1], second[1]} == {"miss", "shared"}

    asyncio.run(scenario())


def test_cache_expires_after_bounded_ttl() -> None:
    async def scenario() -> None:
        now = [100.0]
        calls = 0
        store: IdempotencyStore[int] = IdempotencyStore(
            ttl_seconds=10,
            max_entries=8,
            clock=lambda: now[0],
        )

        async def producer() -> int:
            nonlocal calls
            calls += 1
            return calls

        first = await store.execute(key="request-1", fingerprint="body-a", producer=producer)
        cached = await store.execute(key="request-1", fingerprint="body-a", producer=producer)
        now[0] = 111.0
        expired = await store.execute(key="request-1", fingerprint="body-a", producer=producer)

        assert first == (1, "miss")
        assert cached == (1, "hit")
        assert expired == (2, "miss")

    asyncio.run(scenario())


def test_same_key_with_different_fingerprint_is_rejected() -> None:
    async def scenario() -> None:
        store: IdempotencyStore[str] = IdempotencyStore(ttl_seconds=60, max_entries=8)

        async def producer() -> str:
            return "result"

        await store.execute(key="request-1", fingerprint="body-a", producer=producer)
        with pytest.raises(IdempotencyConflict):
            await store.execute(key="request-1", fingerprint="body-b", producer=producer)

    asyncio.run(scenario())

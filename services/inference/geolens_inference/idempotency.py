from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Generic, Literal, TypeVar


T = TypeVar("T")
CacheStatus = Literal["miss", "hit", "shared"]


class IdempotencyConflict(Exception):
    """The same idempotency key was reused with a different request body."""


@dataclass(frozen=True, slots=True)
class _Completed(Generic[T]):
    fingerprint: str
    value: T
    expires_at: float


@dataclass(frozen=True, slots=True)
class _InFlight(Generic[T]):
    fingerprint: str
    task: asyncio.Task[T]


class IdempotencyStore(Generic[T]):
    """Bounded in-memory result cache with in-flight request coalescing."""

    def __init__(
        self,
        *,
        ttl_seconds: int,
        max_entries: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl_seconds = ttl_seconds
        self._max_entries = max_entries
        self._clock = clock
        self._completed: OrderedDict[str, _Completed[T]] = OrderedDict()
        self._in_flight: dict[str, _InFlight[T]] = {}
        self._lock = asyncio.Lock()

    def _prune_locked(self, now: float) -> None:
        expired = [key for key, entry in self._completed.items() if entry.expires_at <= now]
        for key in expired:
            self._completed.pop(key, None)
        while len(self._completed) > self._max_entries:
            self._completed.popitem(last=False)

    async def _run_and_store(
        self,
        key: str,
        fingerprint: str,
        producer: Callable[[], Awaitable[T]],
    ) -> T:
        try:
            value = await producer()
            async with self._lock:
                self._completed[key] = _Completed(
                    fingerprint=fingerprint,
                    value=value,
                    expires_at=self._clock() + self._ttl_seconds,
                )
                self._completed.move_to_end(key)
                self._prune_locked(self._clock())
            return value
        finally:
            async with self._lock:
                current = self._in_flight.get(key)
                if current is not None and current.task is asyncio.current_task():
                    self._in_flight.pop(key, None)

    async def execute(
        self,
        *,
        key: str,
        fingerprint: str,
        producer: Callable[[], Awaitable[T]],
    ) -> tuple[T, CacheStatus]:
        async with self._lock:
            now = self._clock()
            self._prune_locked(now)
            completed = self._completed.get(key)
            if completed is not None:
                if completed.fingerprint != fingerprint:
                    raise IdempotencyConflict
                self._completed.move_to_end(key)
                return completed.value, "hit"

            in_flight = self._in_flight.get(key)
            if in_flight is not None:
                if in_flight.fingerprint != fingerprint:
                    raise IdempotencyConflict
                task = in_flight.task
                cache_status: CacheStatus = "shared"
            else:
                task = asyncio.create_task(self._run_and_store(key, fingerprint, producer))
                task.add_done_callback(lambda completed_task: completed_task.exception() if not completed_task.cancelled() else None)
                self._in_flight[key] = _InFlight(fingerprint=fingerprint, task=task)
                cache_status = "miss"

        return await asyncio.shield(task), cache_status

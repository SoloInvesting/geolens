from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
from collections.abc import AsyncIterator


class InferenceCapacityExceeded(RuntimeError):
    """Raised when all execution and queue slots are already admitted."""


class InferenceQueueTimeout(RuntimeError):
    """Raised when an admitted request cannot obtain an execution slot in time."""


@dataclass(frozen=True, slots=True)
class CapacitySnapshot:
    active: int
    queued: int
    limit: int
    queue_limit: int


class InferenceCapacity:
    """Bound concurrent inference and the number of requests waiting behind it."""

    def __init__(
        self,
        *,
        max_concurrent: int,
        max_queued: int,
        queue_timeout_seconds: float,
    ) -> None:
        if max_concurrent < 1:
            raise ValueError("max_concurrent must be at least 1.")
        if max_queued < 0:
            raise ValueError("max_queued must not be negative.")
        if queue_timeout_seconds <= 0:
            raise ValueError("queue_timeout_seconds must be positive.")
        self._max_concurrent = max_concurrent
        self._max_queued = max_queued
        self._queue_timeout_seconds = queue_timeout_seconds
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._state_lock = asyncio.Lock()
        self._admitted = 0
        self._active = 0

    async def snapshot(self) -> CapacitySnapshot:
        async with self._state_lock:
            return CapacitySnapshot(
                active=self._active,
                queued=self._admitted - self._active,
                limit=self._max_concurrent,
                queue_limit=self._max_queued,
            )

    @asynccontextmanager
    async def slot(self) -> AsyncIterator[None]:
        async with self._state_lock:
            if self._admitted >= self._max_concurrent + self._max_queued:
                raise InferenceCapacityExceeded("Inference capacity and queue are full.")
            self._admitted += 1

        acquired = False
        try:
            try:
                await asyncio.wait_for(
                    self._semaphore.acquire(),
                    timeout=self._queue_timeout_seconds,
                )
            except asyncio.TimeoutError as exc:
                raise InferenceQueueTimeout("Timed out while waiting for an inference slot.") from exc
            acquired = True
            async with self._state_lock:
                self._active += 1
            yield
        finally:
            async with self._state_lock:
                self._admitted -= 1
                if acquired:
                    self._active -= 1
            if acquired:
                self._semaphore.release()

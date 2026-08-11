from __future__ import annotations

import asyncio
from pathlib import Path
import sys

import pytest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from geolens_inference.capacity import (  # noqa: E402
    InferenceCapacity,
    InferenceCapacityExceeded,
    InferenceQueueTimeout,
)


def test_capacity_limits_active_runs_and_bounds_the_queue() -> None:
    async def scenario() -> None:
        capacity = InferenceCapacity(
            max_concurrent=1,
            max_queued=1,
            queue_timeout_seconds=1,
        )
        release_first = asyncio.Event()
        first_active = asyncio.Event()
        execution_order: list[str] = []

        async def first() -> None:
            async with capacity.slot():
                execution_order.append("first-start")
                first_active.set()
                await release_first.wait()
                execution_order.append("first-end")

        async def second() -> None:
            async with capacity.slot():
                execution_order.append("second")

        first_task = asyncio.create_task(first())
        await first_active.wait()
        second_task = asyncio.create_task(second())
        for _ in range(20):
            if (await capacity.snapshot()).queued == 1:
                break
            await asyncio.sleep(0)

        snapshot = await capacity.snapshot()
        assert snapshot.active == 1
        assert snapshot.queued == 1
        with pytest.raises(InferenceCapacityExceeded):
            async with capacity.slot():
                raise AssertionError("A third request must not receive a slot.")

        release_first.set()
        await asyncio.gather(first_task, second_task)

        assert execution_order == ["first-start", "first-end", "second"]
        assert (await capacity.snapshot()).active == 0
        assert (await capacity.snapshot()).queued == 0

    asyncio.run(scenario())


def test_waiting_request_times_out_and_releases_its_queue_slot() -> None:
    async def scenario() -> None:
        capacity = InferenceCapacity(
            max_concurrent=1,
            max_queued=1,
            queue_timeout_seconds=0.01,
        )
        release_first = asyncio.Event()
        first_active = asyncio.Event()

        async def first() -> None:
            async with capacity.slot():
                first_active.set()
                await release_first.wait()

        first_task = asyncio.create_task(first())
        await first_active.wait()
        with pytest.raises(InferenceQueueTimeout):
            async with capacity.slot():
                raise AssertionError("A timed-out request must not receive a slot.")

        snapshot = await capacity.snapshot()
        assert snapshot.active == 1
        assert snapshot.queued == 0
        release_first.set()
        await first_task

    asyncio.run(scenario())

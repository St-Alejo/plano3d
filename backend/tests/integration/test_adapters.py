"""Adaptadores de infraestructura con dobles realistas (fakeredis, disco temporal)."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fakeredis import FakeAsyncRedis

from plano3d.application.dto import ProgressEventDTO
from plano3d.infrastructure.memory import InProcessJobQueue, LocalFileStorage
from plano3d.infrastructure.realtime.redis_broker import RedisProgressBroker


def ev(stage: str, status: str = "completed", index: int = 1) -> ProgressEventDTO:
    return ProgressEventDTO(project_id="p", stage=stage, status=status, index=index, total=3)  # type: ignore[arg-type]


async def test_redis_broker_history_live_and_reset() -> None:
    broker = RedisProgressBroker(FakeAsyncRedis())
    await broker.publish(ev("ingest", "started", 0))
    await broker.publish(ev("ingest"))
    assert [e.stage for e in await broker.history("p")] == ["ingest", "ingest"]

    received: list[str] = []

    async def consume() -> None:
        async for e in broker.subscribe("p"):
            received.append(f"{e.stage}:{e.status}")

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.05)
    await broker.publish(ev("walls"))
    await broker.publish(ev("done"))
    await asyncio.wait_for(task, 2)
    assert received == ["ingest:started", "ingest:completed", "walls:completed", "done:completed"]

    # un nuevo análisis (índice 0) limpia el historial anterior
    await broker.publish(ev("ingest", "started", 0))
    assert len(await broker.history("p")) == 1
    await broker.reset("p")
    assert await broker.history("p") == []


async def test_redis_broker_returns_immediately_when_already_done() -> None:
    broker = RedisProgressBroker(FakeAsyncRedis())
    await broker.publish(ev("done"))
    events = [e async for e in broker.subscribe("p")]
    assert [e.stage for e in events] == ["done"]


async def test_local_storage_round_trip_and_path_traversal(tmp_path: Path) -> None:
    storage = LocalFileStorage(tmp_path)
    await storage.put("originals/a.png", b"123", "image/png")
    assert await storage.get("originals/a.png") == b"123"
    await storage.delete("originals/a.png")
    await storage.delete("originals/a.png")  # idempotente
    with pytest.raises(FileNotFoundError):
        await storage.get("originals/a.png")
    with pytest.raises(ValueError):
        await storage.put("../fuera.txt", b"x", "text/plain")


async def test_in_process_queue_requires_handler_and_drains() -> None:
    queue = InProcessJobQueue()
    with pytest.raises(RuntimeError):
        await queue.enqueue_analysis("p")
    done: list[str] = []

    async def handler(pid: str) -> None:
        await asyncio.sleep(0.01)
        done.append(pid)

    queue.bind(handler)
    await queue.enqueue_analysis("a")
    await queue.enqueue_analysis("b")
    await queue.drain()
    assert sorted(done) == ["a", "b"]

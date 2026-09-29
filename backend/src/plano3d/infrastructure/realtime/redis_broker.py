"""Progreso en tiempo real vía Redis: el worker publica, la API reenvía por WebSocket.

Cada evento se guarda además en una lista (con expiración) para que un cliente
que se conecta tarde reciba el historial completo.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from redis.asyncio import Redis

from plano3d.application.dto import ProgressEventDTO
from plano3d.application.ports import ProgressBroker

HISTORY_TTL_S = 60 * 60


def _channel(project_id: str) -> str:
    return f"progress:{project_id}"


def _history_key(project_id: str) -> str:
    return f"progress-history:{project_id}"


class RedisProgressBroker(ProgressBroker):
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def publish(self, event: ProgressEventDTO) -> None:
        payload = event.model_dump_json()
        key = _history_key(event.project_id)
        async with self._redis.pipeline(transaction=True) as pipe:
            if event.status == "started" and event.index == 0:
                pipe.delete(key)  # nuevo análisis: historial limpio
            pipe.rpush(key, payload)
            pipe.expire(key, HISTORY_TTL_S)
            pipe.publish(_channel(event.project_id), payload)
            await pipe.execute()

    async def history(self, project_id: str) -> list[ProgressEventDTO]:
        raw: list[bytes] = await self._redis.lrange(_history_key(project_id), 0, -1)  # type: ignore[misc]
        return [ProgressEventDTO.model_validate_json(r) for r in raw]

    async def reset(self, project_id: str) -> None:
        await self._redis.delete(_history_key(project_id))

    async def subscribe(self, project_id: str) -> AsyncIterator[ProgressEventDTO]:
        pubsub = self._redis.pubsub()
        # suscribirse ANTES de leer el historial: así no se pierde ningún evento intermedio
        await pubsub.subscribe(_channel(project_id))
        try:
            history: list[bytes] = await self._redis.lrange(  # type: ignore[misc]
                _history_key(project_id), 0, -1
            )
            seen = set(history)
            for raw in history:
                event = ProgressEventDTO.model_validate_json(raw)
                yield event
                if event.stage == "done":
                    return
            async for message in pubsub.listen():
                if message.get("type") != "message" or message["data"] in seen:
                    continue
                event = ProgressEventDTO.model_validate_json(message["data"])
                yield event
                if event.stage == "done":
                    return
        finally:
            await pubsub.unsubscribe(_channel(project_id))
            await pubsub.aclose()  # type: ignore[no-untyped-call]

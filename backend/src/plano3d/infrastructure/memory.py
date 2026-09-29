"""Adaptadores en memoria: para tests y para correr la API sin Docker (modo ``memory``)."""

from __future__ import annotations

import asyncio
import copy
import logging
from collections import defaultdict
from collections.abc import AsyncIterator, Callable, Coroutine
from pathlib import Path

from plano3d.application.dto import ProgressEventDTO
from plano3d.application.ports import FileStorage, JobQueue, ProgressBroker, ProjectRepository
from plano3d.domain import Project

log = logging.getLogger(__name__)


class InMemoryProjectRepository(ProjectRepository):
    def __init__(self) -> None:
        self._items: dict[str, Project] = {}

    async def add(self, project: Project) -> None:
        self._items[project.id] = copy.deepcopy(project)

    async def get(self, project_id: str) -> Project | None:
        p = self._items.get(project_id)
        return copy.deepcopy(p) if p else None

    async def list(self) -> list[Project]:
        return [copy.deepcopy(p) for p in self._items.values()]

    async def save(self, project: Project) -> None:
        if project.id not in self._items:
            raise KeyError(project.id)
        self._items[project.id] = copy.deepcopy(project)

    async def delete(self, project_id: str) -> None:
        self._items.pop(project_id, None)


class InMemoryFileStorage(FileStorage):
    def __init__(self) -> None:
        self.files: dict[str, tuple[bytes, str]] = {}

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        self.files[key] = (data, content_type)

    async def get(self, key: str) -> bytes:
        try:
            return self.files[key][0]
        except KeyError as exc:
            raise FileNotFoundError(key) from exc

    async def delete(self, key: str) -> None:
        self.files.pop(key, None)


class LocalFileStorage(FileStorage):
    """Guarda en disco. Útil para desarrollo sin MinIO."""

    def __init__(self, root: Path) -> None:
        self._root = root.resolve()
        self._root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self._root / key).resolve()
        if not path.is_relative_to(self._root):
            raise ValueError(f"Clave inválida: {key}")
        return path

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(path.write_bytes, data)

    async def get(self, key: str) -> bytes:
        path = self._path(key)
        if not path.exists():
            raise FileNotFoundError(key)
        return await asyncio.to_thread(path.read_bytes)

    async def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class InMemoryProgressBroker(ProgressBroker):
    def __init__(self) -> None:
        self._history: dict[str, list[ProgressEventDTO]] = defaultdict(list)
        self._subscribers: dict[str, list[asyncio.Queue[ProgressEventDTO]]] = defaultdict(list)

    async def publish(self, event: ProgressEventDTO) -> None:
        self._history[event.project_id].append(event)
        for q in list(self._subscribers[event.project_id]):
            q.put_nowait(event)

    async def reset(self, project_id: str) -> None:
        self._history.pop(project_id, None)

    async def history(self, project_id: str) -> list[ProgressEventDTO]:
        return list(self._history[project_id])

    async def subscribe(self, project_id: str) -> AsyncIterator[ProgressEventDTO]:
        queue: asyncio.Queue[ProgressEventDTO] = asyncio.Queue()
        self._subscribers[project_id].append(queue)
        try:
            for event in list(self._history[project_id]):
                yield event
                if event.stage == "done":
                    return
            while True:
                event = await queue.get()
                yield event
                if event.stage == "done":
                    return
        finally:
            self._subscribers[project_id].remove(queue)


class InProcessJobQueue(JobQueue):
    """Ejecuta el análisis como tarea asyncio del mismo proceso (sin Redis)."""

    def __init__(self) -> None:
        self._handler: Callable[[str], Coroutine[None, None, None]] | None = None
        self._tasks: set[asyncio.Task[None]] = set()

    def bind(self, handler: Callable[[str], Coroutine[None, None, None]]) -> None:
        self._handler = handler

    async def enqueue_analysis(self, project_id: str) -> None:
        if self._handler is None:
            raise RuntimeError("La cola no tiene un manejador asociado")
        task: asyncio.Task[None] = asyncio.create_task(self._handler(project_id))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def drain(self) -> None:
        """Espera a que terminen los trabajos pendientes (tests)."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

"""Edición en vivo: una sala por proyecto que ordena y difunde los cambios (ADR-021).

Patrones Mediator (los clientes no se hablan entre sí: todo pasa por la sala) y Observer
(cada participante recibe lo que pasa en la sala por su cola de salida).

Cada sala tiene el modelo vigente, un número de secuencia ``seq`` que sube con cada lote
de cambios aceptado, un registro de los últimos lotes (para quien se reconecta) y quién
está conectado. Los lotes se validan reconstruyendo el dominio (``apply_ops_to_model``):
uno que rompe una regla del edificio se rechaza solo a su autor. Gana el último en llegar
por entidad. La sala guarda en el repositorio 1,5 s después del último cambio, como una
revisión más del historial («Edición en vivo»).

La sala no sabe de WebSockets: un ``Peer`` es una cola de mensajes JSON. Si un cliente lento
deja que su cola se llene, se le desconecta (la sala nunca espera a nadie).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Final, Literal

from plano3d.application.collab.ownership import interiores_violation
from plano3d.application.ops import apply_ops_to_model, model_json
from plano3d.application.ports import ProjectRepository
from plano3d.application.use_cases.errors import ProjectNotFoundError
from plano3d.application.use_cases.projects import commit_model
from plano3d.domain import BuildingModel
from plano3d.domain.errors import ConcurrencyError, DomainError

log = logging.getLogger(__name__)

Json = dict[str, Any]
#: «interiores» = Interiores 3D enlazado por un código (ADR-024): solo interiorismo
ClientKind = Literal["web", "desktop", "interiores"]

CLIENT_LABEL: Final[dict[str, str]] = {
    "web": "web",
    "desktop": "escritorio",
    "interiores": "Interiores 3D",
}
#: mensajes en cola por participante antes de darlo por caído
QUEUE_SIZE: Final = 256
#: cambios por lote (un «pegar» grande cabe; un abuso no)
MAX_OPS: Final = 5000
#: tamaño del estado de presencia (selección, herramienta, cámara)
MAX_PRESENCE: Final = 4096


class CollabError(Exception):
    """El proyecto no se puede editar en vivo (no existe o aún no tiene modelo)."""


@dataclass(eq=False)
class Peer:
    """Un cliente conectado a una sala. ``outbox`` la vacía el transporte (WebSocket)."""

    id: str
    name: str
    client: ClientKind
    user_id: str | None = None
    outbox: asyncio.Queue[Json | None] = field(
        default_factory=lambda: asyncio.Queue(maxsize=QUEUE_SIZE)
    )
    presence: Json | None = None
    dropped: bool = False

    def public(self) -> Json:
        return {"id": self.id, "name": self.name, "client": self.client, "user_id": self.user_id}

    def deliver(self, message: Json) -> bool:
        """Encola sin esperar. False si la cola está llena (cliente demasiado lento)."""
        if self.dropped:
            return False
        try:
            self.outbox.put_nowait(message)
            return True
        except asyncio.QueueFull:
            self.dropped = True
            return False

    def close(self) -> None:
        """Avisa al transporte que debe cerrar (None = fin de la cola)."""
        self.dropped = True
        with contextlib.suppress(asyncio.QueueFull):
            self.outbox.put_nowait(None)


@dataclass(frozen=True)
class Entry:
    seq: int
    op_id: str
    ops: list[Json]
    author: str

    def message(self) -> Json:
        return {
            "type": "applied",
            "seq": self.seq,
            "op_id": self.op_id,
            "ops": self.ops,
            "author": self.author,
        }


@dataclass(eq=False)
class Room:
    project_id: str
    model: BuildingModel
    revision: int
    seq: int = 0
    log: deque[Entry] = field(default_factory=lambda: deque(maxlen=500))
    peers: dict[str, Peer] = field(default_factory=dict)
    #: lotes aplicados desde el último guardado (quién los hizo: para el resumen)
    unsaved_clients: set[str] = field(default_factory=set)
    save_task: asyncio.Task[None] | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def dirty(self) -> bool:
        return bool(self.unsaved_clients)

    def find(self, op_id: str) -> Entry | None:
        return next((e for e in reversed(self.log) if e.op_id == op_id), None)

    def since(self, last_seq: int) -> list[Entry] | None:
        """Lotes posteriores a ``last_seq``, o None si ya salieron del registro."""
        if last_seq == self.seq:
            return []
        if last_seq > self.seq or not self.log or self.log[0].seq > last_seq + 1:
            return None
        return [e for e in self.log if e.seq > last_seq]


class CollabHub:
    def __init__(self, repo: ProjectRepository, save_delay_s: float = 1.5) -> None:
        self._repo = repo
        self.save_delay_s = save_delay_s
        self._rooms: dict[str, Room] = {}
        self._guard = asyncio.Lock()

    @property
    def repo(self) -> ProjectRepository:
        return self._repo

    @repo.setter
    def repo(self, repo: ProjectRepository) -> None:
        # el contenedor puede envolver el repositorio después (copia en Blob)
        self._repo = repo

    def room(self, project_id: str) -> Room | None:
        return self._rooms.get(project_id)

    # ------------------------------------------------------------ entrar y salir
    async def join(self, project_id: str, peer: Peer, last_seq: int | None = None) -> Room:
        room = await self._open(project_id)
        async with room.lock:
            missed = room.since(last_seq) if last_seq is not None else None
            welcome: Json = {
                "type": "welcome",
                "you": peer.public(),
                "seq": room.seq,
                "revision": room.revision,
                "peers": [{**p.public(), "presence": p.presence} for p in room.peers.values()],
            }
            if missed is None:
                welcome["model"] = model_json(room.model)
            else:
                welcome["missed"] = [e.message() for e in missed]
            room.peers[peer.id] = peer
            peer.deliver(welcome)
            self._broadcast(room, {"type": "peer_joined", "peer": peer.public()}, skip=peer.id)
        log.info("%s (%s) entró a %s", peer.name, peer.client, project_id)
        return room

    async def leave(self, project_id: str, peer_id: str) -> None:
        room = self._rooms.get(project_id)
        if room is None:
            return
        async with room.lock:
            if room.peers.pop(peer_id, None) is None:
                return
            self._broadcast(room, {"type": "peer_left", "peer_id": peer_id})
            empty = not room.peers
        if empty:
            await self.flush(project_id)
            async with self._guard:
                if not room.peers and self._rooms.get(project_id) is room:
                    del self._rooms[project_id]

    async def _open(self, project_id: str) -> Room:
        async with self._guard:
            room = self._rooms.get(project_id)
            if room is not None:
                return room
            project = await self._repo.get(project_id)
            if project is None:
                raise ProjectNotFoundError(project_id)
            if project.model is None:
                raise CollabError("El proyecto aún no tiene modelo para editar")
            room = Room(project_id, project.model, project.revision)
            self._rooms[project_id] = room
            return room

    # ------------------------------------------------------------ cambios
    async def submit(
        self, project_id: str, peer_id: str, op_id: str, ops: Sequence[Json]
    ) -> Entry | None:
        """Aplica un lote. Devuelve la entrada aceptada, o None si se rechazó."""
        room = self._rooms.get(project_id)
        if room is None:
            return None
        async with room.lock:
            peer = room.peers.get(peer_id)
            if peer is None:
                return None
            done = room.find(op_id)
            if done is not None:
                # reintento tras reconectar: ya estaba aplicado, solo se confirma
                peer.deliver(done.message())
                return done
            if not ops:
                peer.deliver({"type": "reject", "op_id": op_id, "reason": "Lote vacío"})
                return None
            if len(ops) > MAX_OPS:
                peer.deliver(
                    {"type": "reject", "op_id": op_id, "reason": "Demasiados cambios en un lote"}
                )
                return None
            if peer.client == "interiores":
                reason = interiores_violation(model_json(room.model), ops)
                if reason is not None:
                    peer.deliver({"type": "reject", "op_id": op_id, "reason": reason})
                    return None
            try:
                model = apply_ops_to_model(room.model, list(ops))
            except (DomainError, ValueError, KeyError, TypeError) as exc:
                peer.deliver({"type": "reject", "op_id": op_id, "reason": _reason(exc)})
                return None
            room.model = model
            room.seq += 1
            entry = Entry(room.seq, op_id, list(ops), peer.id)
            room.log.append(entry)
            room.unsaved_clients.add(peer.client)
            self._broadcast(room, entry.message())
            self._schedule_save(room)
            return entry

    async def relay(self, project_id: str, peer_id: str, kind: str, payload: Json) -> None:
        """Presencia (selección, herramienta, cámara) y arrastres en curso: no se guardan."""
        room = self._rooms.get(project_id)
        if room is None or peer_id not in room.peers:
            return
        if kind == "presence":
            room.peers[peer_id].presence = payload
            self._broadcast(
                room, {"type": "presence", "peer_id": peer_id, "state": payload}, skip=peer_id
            )
        elif kind == "preview":
            self._broadcast(
                room, {"type": "preview", "peer_id": peer_id, "entity": payload}, skip=peer_id
            )

    # ------------------------------------------------------------ guardar
    def _schedule_save(self, room: Room) -> None:
        if room.save_task is not None and not room.save_task.done():
            room.save_task.cancel()  # espera desde el último cambio
        room.save_task = asyncio.get_running_loop().create_task(self._save_later(room))

    async def _save_later(self, room: Room) -> None:
        await asyncio.sleep(self.save_delay_s)
        try:
            await self._save(room)
        except Exception:
            log.exception("No se pudo guardar la edición en vivo de %s", room.project_id)

    async def _save(self, room: Room) -> None:
        async with room.lock:
            if not room.dirty:
                return
            clients = sorted(CLIENT_LABEL[c] for c in room.unsaved_clients)
            summary = "Edición en vivo (" + " y ".join(clients) + ")"
            project = await self._repo.get(room.project_id)
            if project is None:
                return
            try:
                saved = await commit_model(self._repo, project, room.model, summary, room.revision)
            except ConcurrencyError:
                # alguien guardó por fuera de la sala: manda lo guardado
                log.warning("Edición en vivo de %s pisada por otro guardado", room.project_id)
                await self._reload_locked(room)
                return
            room.revision = saved.revision
            room.unsaved_clients.clear()
            self._broadcast(room, {"type": "saved", "revision": room.revision, "seq": room.seq})

    async def flush(self, project_id: str) -> None:
        """Guarda ya lo pendiente (antes de una edición por REST o al cerrar la sala)."""
        room = self._rooms.get(project_id)
        if room is None:
            return
        if room.save_task is not None and not room.save_task.done():
            room.save_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await room.save_task
        await self._save(room)

    async def reload(self, project_id: str) -> None:
        """Tras una edición por REST (fachada, muebles, piso nuevo, restaurar): todos
        reciben el modelo guardado completo."""
        room = self._rooms.get(project_id)
        if room is None:
            return
        async with room.lock:
            await self._reload_locked(room)

    async def _reload_locked(self, room: Room) -> None:
        project = await self._repo.get(room.project_id)
        if project is None or project.model is None:
            self._close_locked(room, "El proyecto ya no existe")
            return
        changed = project.revision != room.revision or project.model != room.model
        room.model, room.revision = project.model, project.revision
        room.unsaved_clients.clear()
        if not changed:
            return
        room.seq += 1
        room.log.clear()  # quien venía de antes recibe el modelo entero al reconectar
        self._broadcast(
            room,
            {
                "type": "snapshot",
                "seq": room.seq,
                "revision": room.revision,
                "model": model_json(room.model),
            },
        )

    async def close_project(self, project_id: str, reason: str) -> None:
        """El proyecto se borró: se avisa y se cierra la sala sin guardar."""
        room = self._rooms.get(project_id)
        if room is None:
            return
        async with room.lock:
            self._close_locked(room, reason)

    def _close_locked(self, room: Room, reason: str) -> None:
        if room.save_task is not None:
            room.save_task.cancel()
        room.unsaved_clients.clear()
        self._broadcast(room, {"type": "closed", "reason": reason})
        for p in room.peers.values():
            p.close()
        room.peers.clear()
        self._rooms.pop(room.project_id, None)

    async def aclose(self) -> None:
        """Al apagar la API: guarda todas las salas y desconecta."""
        for project_id in list(self._rooms):
            try:
                await self.flush(project_id)
            except Exception:
                log.exception("No se pudo guardar %s al apagar", project_id)
            room = self._rooms.pop(project_id, None)
            if room:
                for p in room.peers.values():
                    p.close()

    # ------------------------------------------------------------ difusión
    def announce(self, project_id: str, message: Json) -> None:
        """Aviso a todos los conectados al proyecto (p. ej. ``render_added``); sin sala, nada."""
        room = self._rooms.get(project_id)
        if room is not None:
            self._broadcast(room, message)

    def _broadcast(self, room: Room, message: Json, skip: str | None = None) -> None:
        slow = [p for pid, p in room.peers.items() if pid != skip and not p.deliver(message)]
        for p in slow:
            log.warning("%s no da abasto: se desconecta de %s", p.name, room.project_id)
            p.close()


def _reason(exc: Exception) -> str:
    text = str(exc).strip()
    if isinstance(exc, DomainError) and text:
        return text
    return "Cambio inválido" + (f": {text}" if text else "")


def presence_ok(state: Any) -> bool:
    """La presencia es un objeto JSON pequeño."""
    import json

    return isinstance(state, dict) and len(json.dumps(state)) <= MAX_PRESENCE

"""WebSocket de edición en vivo (ADR-021): /api/ws/collab/{project_id}?ticket=...

Protocolo (JSON, un mensaje por cuadro de texto):

Cliente → servidor
    {"type": "hello", "client": "web"|"desktop", "last_seq": n|null}   primero, siempre
    {"type": "ops", "op_id": "...", "ops": [...]}                      lote de cambios (ADR-019)
    {"type": "presence", "state": {...}}                               selección, herramienta, piso
    {"type": "preview", "entity": {...}}                               arrastre en curso
    {"type": "ping"}

Servidor → cliente
    welcome {you, seq, revision, peers, model | missed}   model entero, o los lotes perdidos
    applied {seq, op_id, ops, author}                     también al autor (es su confirmación)
    reject  {op_id, reason}                               solo al autor
    snapshot {seq, revision, model}                       tras una edición por REST
    saved {revision, seq}                                 la sala guardó una revisión
    presence {peer_id, state} · preview {peer_id, entity}
    peer_joined {peer} · peer_left {peer_id} · closed {reason} · pong · error {reason}
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from plano3d.api.deps import WS_UNAUTHORIZED, ensure_access, ws_user
from plano3d.application.collab.hub import CollabError, CollabHub, Peer, presence_ok
from plano3d.application.use_cases.errors import ProjectNotFoundError
from plano3d.container import Container
from plano3d.domain import new_id

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["edición en vivo"])

#: el proyecto no existe o no se puede editar en vivo
WS_NOT_FOUND = 4404
#: el primer mensaje no fue un saludo válido
WS_BAD_HELLO = 4400
HELLO_TIMEOUT_S = 10.0
#: el cliente manda ping cada 25 s; sin nada en este tiempo se da por caído
IDLE_TIMEOUT_S = 75.0
MAX_MESSAGE = 4_000_000


@router.websocket("/ws/collab/{project_id}")
async def collab_ws(
    websocket: WebSocket, project_id: str, ticket: Annotated[str | None, Query()] = None
) -> None:
    container: Container = websocket.app.state.container
    ok, user = await ws_user(websocket, ticket)
    if ok:
        try:
            await ensure_access(container, user, project_id)
        except ProjectNotFoundError:
            ok = False
    if not ok:
        await websocket.close(code=WS_UNAUTHORIZED)
        return
    await websocket.accept()

    hello = await _hello(websocket)
    if hello is None:
        await websocket.close(code=WS_BAD_HELLO)
        return
    client = hello.get("client") if hello.get("client") in ("web", "desktop") else "web"
    last_seq = hello.get("last_seq")
    peer = Peer(
        id=new_id("peer"),
        name=user.name if user else "Invitado",
        client=client,  # type: ignore[arg-type]
        user_id=user.id if user else None,
    )
    hub = container.collab
    try:
        await hub.join(project_id, peer, last_seq if isinstance(last_seq, int) else None)
    except (ProjectNotFoundError, CollabError) as exc:
        await websocket.close(code=WS_NOT_FOUND, reason=str(exc)[:120])
        return

    writer = asyncio.create_task(_pump(websocket, peer))
    try:
        while not peer.dropped:
            raw = await asyncio.wait_for(websocket.receive_text(), IDLE_TIMEOUT_S)
            await _dispatch(hub, project_id, peer, raw)
    except (WebSocketDisconnect, TimeoutError, RuntimeError):
        pass
    finally:
        await hub.leave(project_id, peer.id)
        peer.close()
        try:
            await asyncio.wait_for(writer, 2)
        except (TimeoutError, asyncio.CancelledError):
            writer.cancel()
        with contextlib.suppress(RuntimeError, WebSocketDisconnect):
            await websocket.close()


async def _hello(websocket: WebSocket) -> dict[str, Any] | None:
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), HELLO_TIMEOUT_S)
        msg = json.loads(raw)
    except (TimeoutError, ValueError, WebSocketDisconnect, RuntimeError):
        return None
    if not isinstance(msg, dict) or msg.get("type") != "hello":
        return None
    return msg


async def _pump(websocket: WebSocket, peer: Peer) -> None:
    """Vacía la cola del participante hacia el socket (un solo escritor por socket)."""
    try:
        while (message := await peer.outbox.get()) is not None:
            await websocket.send_text(json.dumps(message, ensure_ascii=False))
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        peer.dropped = True
        with contextlib.suppress(RuntimeError, WebSocketDisconnect):
            await websocket.close()


async def _dispatch(hub: CollabHub, project_id: str, peer: Peer, raw: str) -> None:
    if len(raw) > MAX_MESSAGE:
        peer.deliver({"type": "error", "reason": "Mensaje demasiado grande"})
        return
    try:
        msg = json.loads(raw)
    except ValueError:
        peer.deliver({"type": "error", "reason": "JSON inválido"})
        return
    kind = msg.get("type") if isinstance(msg, dict) else None
    if kind == "ping":
        peer.deliver({"type": "pong"})
    elif kind == "ops":
        op_id, ops = msg.get("op_id"), msg.get("ops")
        if not isinstance(op_id, str) or not 0 < len(op_id) <= 100 or not isinstance(ops, list):
            peer.deliver({"type": "error", "reason": "Lote de cambios mal formado"})
            return
        await hub.submit(project_id, peer.id, op_id, ops)
    elif kind in ("presence", "preview"):
        payload = msg.get("state" if kind == "presence" else "entity")
        if presence_ok(payload):
            await hub.relay(project_id, peer.id, kind, payload)
    else:
        peer.deliver({"type": "error", "reason": f"Mensaje desconocido: {kind}"})

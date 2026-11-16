"""Sala de edición en vivo (ADR-021): orden, rechazo, reconexión, guardado y REST."""

from __future__ import annotations

import asyncio
import copy
from collections.abc import Awaitable, Callable
from typing import Any

from plano3d.application.collab.hub import CollabHub, Peer
from plano3d.application.ops import model_json
from plano3d.application.use_cases.projects import commit_model
from plano3d.infrastructure.demo import DEMO_PROJECT_ID, demo_project
from plano3d.infrastructure.memory import InMemoryProjectRepository

Json = dict[str, Any]
LEVEL = "lvl_0"
FURN = "f_r_f90d86562b_1"


def run(test: Callable[[], Awaitable[None]]) -> None:
    asyncio.run(test())


async def _setup(delay: float = 10.0) -> tuple[InMemoryProjectRepository, CollabHub]:
    repo = InMemoryProjectRepository()
    project, _ = demo_project()
    await repo.add(project)
    return repo, CollabHub(repo, save_delay_s=delay)


def _drain(peer: Peer) -> list[Json]:
    out: list[Json] = []
    while not peer.outbox.empty():
        msg = peer.outbox.get_nowait()
        if msg is not None:
            out.append(msg)
    return out


def _furniture(model: Json) -> Json:
    level = next(lv for lv in model["levels"] if lv["id"] == LEVEL)
    found: Json = next(f for f in level["furniture"] if f["id"] == FURN)
    return found


def _move(model: Json, x: float) -> list[Json]:
    moved = copy.deepcopy(_furniture(model))
    moved["position"]["x"] = x
    return [{"t": "put", "k": "furniture", "level": LEVEL, "id": FURN, "v": moved}]


def test_un_cambio_llega_a_todos_y_el_autor_lo_ve_como_confirmacion() -> None:
    async def t() -> None:
        _, hub = await _setup()
        ana, beto = Peer("p1", "Ana", "web"), Peer("p2", "Beto", "desktop")
        await hub.join(DEMO_PROJECT_ID, ana)
        welcome = _drain(ana)[0]
        assert welcome["type"] == "welcome" and welcome["seq"] == 0
        assert welcome["model"]["levels"][0]["id"] == LEVEL
        await hub.join(DEMO_PROJECT_ID, beto)
        assert [m["type"] for m in _drain(ana)] == ["peer_joined"]
        assert _drain(beto)[0]["peers"][0]["name"] == "Ana"

        entry = await hub.submit(DEMO_PROJECT_ID, "p1", "op-1", _move(welcome["model"], 3.0))
        assert entry is not None and entry.seq == 1
        for peer in (ana, beto):
            (msg,) = _drain(peer)
            assert msg == {
                "type": "applied",
                "seq": 1,
                "op_id": "op-1",
                "ops": entry.ops,
                "author": "p1",
            }
        room = hub.room(DEMO_PROJECT_ID)
        assert room is not None
        assert _furniture(model_json(room.model))["position"]["x"] == 3.0

    run(t)


def test_un_cambio_invalido_se_rechaza_solo_a_su_autor() -> None:
    async def t() -> None:
        _, hub = await _setup()
        ana, beto = Peer("p1", "Ana", "web"), Peer("p2", "Beto", "web")
        await hub.join(DEMO_PROJECT_ID, ana)
        await hub.join(DEMO_PROJECT_ID, beto)
        _drain(ana), _drain(beto)
        bad = [{"t": "del", "k": "wall", "level": "no-existe", "id": "w1"}]
        assert await hub.submit(DEMO_PROJECT_ID, "p1", "op-x", bad) is None
        (msg,) = _drain(ana)
        assert msg["type"] == "reject" and msg["op_id"] == "op-x" and msg["reason"]
        assert _drain(beto) == []
        room = hub.room(DEMO_PROJECT_ID)
        assert room is not None and room.seq == 0

    run(t)


def test_reintentar_un_lote_ya_aplicado_no_lo_repite() -> None:
    async def t() -> None:
        _, hub = await _setup()
        ana, beto = Peer("p1", "Ana", "web"), Peer("p2", "Beto", "web")
        model = (await hub.join(DEMO_PROJECT_ID, ana)).model
        await hub.join(DEMO_PROJECT_ID, beto)
        ops = _move(model_json(model), 4.0)
        await hub.submit(DEMO_PROJECT_ID, "p1", "op-1", ops)
        _drain(ana), _drain(beto)
        again = await hub.submit(DEMO_PROJECT_ID, "p1", "op-1", ops)
        assert again is not None and again.seq == 1
        assert [m["seq"] for m in _drain(ana)] == [1]
        assert _drain(beto) == []

    run(t)


def test_al_reconectar_recibe_solo_lo_que_se_perdio() -> None:
    async def t() -> None:
        _, hub = await _setup()
        ana = Peer("p1", "Ana", "web")
        model = model_json((await hub.join(DEMO_PROJECT_ID, ana)).model)
        for i in range(3):
            await hub.submit(DEMO_PROJECT_ID, "p1", f"op-{i}", _move(model, float(i)))
        back = Peer("p3", "Ana", "web")
        await hub.join(DEMO_PROJECT_ID, back, last_seq=1)
        welcome = _drain(back)[0]
        assert "model" not in welcome
        assert [m["seq"] for m in welcome["missed"]] == [2, 3]
        # al día: nada que mandar; de otra época: el modelo entero
        fresh, old = Peer("p4", "x", "web"), Peer("p5", "y", "web")
        await hub.join(DEMO_PROJECT_ID, fresh, last_seq=3)
        assert _drain(fresh)[0]["missed"] == []
        await hub.join(DEMO_PROJECT_ID, old, last_seq=99)
        assert "model" in _drain(old)[0]

    run(t)


def test_guarda_una_revision_despues_de_la_rafaga() -> None:
    async def t() -> None:
        repo, hub = await _setup(delay=0.05)
        ana, beto = Peer("p1", "Ana", "web"), Peer("p2", "Beto", "desktop")
        model = model_json((await hub.join(DEMO_PROJECT_ID, ana)).model)
        await hub.join(DEMO_PROJECT_ID, beto)
        for i in range(5):
            await hub.submit(DEMO_PROJECT_ID, "p1", f"a{i}", _move(model, 1.0 + i))
        await hub.submit(DEMO_PROJECT_ID, "p2", "b0", _move(model, 9.5))
        await asyncio.sleep(0.2)
        project = await repo.get(DEMO_PROJECT_ID)
        assert project is not None and project.revision == 2
        assert project.model is not None
        assert _furniture(model_json(project.model))["position"]["x"] == 9.5
        (latest, *_) = await repo.list_revisions(DEMO_PROJECT_ID)
        assert latest.summary == "Edición en vivo (escritorio y web)"
        saved = [m for m in _drain(ana) if m["type"] == "saved"]
        assert saved == [{"type": "saved", "revision": 2, "seq": 6}]

    run(t)


def test_una_edicion_por_rest_llega_como_modelo_entero() -> None:
    async def t() -> None:
        repo, hub = await _setup()
        ana = Peer("p1", "Ana", "web")
        model = model_json((await hub.join(DEMO_PROJECT_ID, ana)).model)
        await hub.submit(DEMO_PROJECT_ID, "p1", "a", _move(model, 2.0))
        _drain(ana)
        # lo que hace collab_sync alrededor de la ruta REST
        await hub.flush(DEMO_PROJECT_ID)
        project = await repo.get(DEMO_PROJECT_ID)
        assert project is not None and project.model is not None
        assert _furniture(model_json(project.model))["position"]["x"] == 2.0
        await commit_model(
            repo, project, project.model.with_facade("moderna_ladrillo", None), "Fachada"
        )
        await hub.reload(DEMO_PROJECT_ID)
        snap = [m for m in _drain(ana) if m["type"] == "snapshot"]
        assert len(snap) == 1 and snap[0]["revision"] == 3
        assert snap[0]["model"]["facade"] == "moderna_ladrillo"

    run(t)


def test_un_cliente_lento_se_desconecta_sin_frenar_la_sala() -> None:
    async def t() -> None:
        _, hub = await _setup()
        fast, slow = Peer("p1", "Ana", "web"), Peer("p2", "Lento", "web")
        slow.outbox = asyncio.Queue(maxsize=2)
        model = model_json((await hub.join(DEMO_PROJECT_ID, fast)).model)
        await hub.join(DEMO_PROJECT_ID, slow)
        for i in range(5):
            await hub.submit(DEMO_PROJECT_ID, "p1", f"a{i}", _move(model, float(i)))
            _drain(fast)
        assert slow.dropped

    run(t)


def test_la_sala_se_guarda_y_se_cierra_al_salir_el_ultimo() -> None:
    async def t() -> None:
        repo, hub = await _setup()
        ana = Peer("p1", "Ana", "web")
        model = model_json((await hub.join(DEMO_PROJECT_ID, ana)).model)
        await hub.submit(DEMO_PROJECT_ID, "p1", "a", _move(model, 5.5))
        await hub.leave(DEMO_PROJECT_ID, "p1")
        assert hub.room(DEMO_PROJECT_ID) is None
        project = await repo.get(DEMO_PROJECT_ID)
        assert project is not None and project.revision == 2

    run(t)

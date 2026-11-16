"""Códigos para compartir y regla de dueños de Interiores (ADR-024)."""

from __future__ import annotations

import asyncio

import pytest

from plano3d.application.collab.ownership import interiores_violation
from plano3d.domain.share import (
    InvalidShareError,
    ProjectShare,
    format_share_code,
    normalize_share_code,
)
from plano3d.infrastructure.memory import (
    InMemoryProjectRepository,
    InMemoryShareRepository,
    InMemoryUserRepository,
)
from plano3d.infrastructure.snapshot import decode_state, encode_state

ROOM = {
    "id": "r1",
    "label": "Sala",
    "polygon": [{"x": 0, "y": 0}, {"x": 4, "y": 0}, {"x": 4, "y": 3}],
    "room_type": "sala",
    "floor_material": None,
    "area": 6.0,
}
MODEL = {"levels": [{"id": "L1", "rooms": [ROOM], "walls": [], "furniture": []}]}


def _room_put(**changes: object) -> dict[str, object]:
    return {"t": "put", "k": "room", "level": "L1", "id": "r1", "v": {**ROOM, **changes}}


def test_codigo_se_normaliza_y_formatea() -> None:
    share = ProjectShare.create("prj_1", "usr_1")
    assert len(share.code) == 8
    assert normalize_share_code(f" {format_share_code(share.code).lower()} ") == share.code
    with pytest.raises(InvalidShareError):
        normalize_share_code("O0I1-ABCD")  # letras ambiguas: no están en el alfabeto
    assert share.revoked().active is False and share.active


@pytest.mark.parametrize(
    ("ops", "allowed"),
    [
        ([{"t": "put", "k": "furniture", "level": "L1", "id": "f1", "v": {}}], True),
        ([{"t": "del", "k": "furniture", "level": "L1", "id": "f1"}], True),
        ([_room_put(floor_material="madera_roble")], True),
        ([_room_put(floor_material="porcelanato", area=6.5)], True),  # área: derivada
        ([_room_put(label="Estar")], False),
        ([_room_put(polygon=[{"x": 0, "y": 0}, {"x": 5, "y": 0}, {"x": 5, "y": 3}])], False),
        ([{"t": "del", "k": "room", "level": "L1", "id": "r1"}], False),
        ([{"t": "put", "k": "wall", "level": "L1", "id": "w1", "v": {}}], False),
        ([{"t": "set", "k": "model", "f": "facade", "v": "moderna"}], False),
        ([{"t": "put", "k": "level", "id": "L2", "v": {}}], False),
    ],
)
def test_interiores_solo_toca_muebles_y_acabados(
    ops: list[dict[str, object]], allowed: bool
) -> None:
    assert (interiores_violation(MODEL, ops) is None) is allowed


def test_lote_mixto_se_rechaza_entero() -> None:
    ops = [
        {"t": "put", "k": "furniture", "level": "L1", "id": "f1", "v": {}},
        {"t": "del", "k": "wall", "level": "L1", "id": "w1"},
    ]
    assert interiores_violation(MODEL, ops) is not None


def test_la_copia_del_estado_guarda_los_codigos() -> None:
    async def run() -> None:
        shares = InMemoryShareRepository()
        kept = ProjectShare.create("prj_1", "usr_1").claimed()
        gone = ProjectShare.create("prj_1", "usr_1").revoked()
        await shares.add(kept)
        await shares.add(gone)
        data = await encode_state(InMemoryProjectRepository(), InMemoryUserRepository(), shares)

        restored = InMemoryShareRepository()
        await decode_state(data, InMemoryProjectRepository(), InMemoryUserRepository(), restored)
        assert await restored.get(kept.code) == kept
        assert await restored.get(gone.code) == gone

    asyncio.run(run())

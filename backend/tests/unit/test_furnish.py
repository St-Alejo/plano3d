"""Amoblar un piso por tipo de ambiente (domain/furnish.py)."""

from __future__ import annotations

import math

import pytest
from shapely.geometry import Polygon

from plano3d.domain import Furniture, Level, Opening, OpeningKind, Point2D, Room, RoomType, Wall
from plano3d.domain.furnish import _blocked, _of, furnish, missing_furniture


def box_room(kind: RoomType, w: float, h: float, label: str = "", rid: str = "r1") -> Room:
    pts = (Point2D(0, 0), Point2D(w, 0), Point2D(w, h), Point2D(0, h))
    return Room(id=rid, label=label or kind.value, polygon=pts, room_type=kind)


def box_walls(w: float, h: float, door_at: float | None = None) -> tuple[Wall, ...]:
    """Contorno de muros; la puerta (si hay) en el muro de abajo (y = h)."""
    c = [(0, 0), (w, 0), (w, h), (0, h)]
    walls = []
    for i in range(4):
        ops: tuple[Opening, ...] = ()
        if i == 2 and door_at is not None:
            # el muro de abajo va de (w, h) a (0, h): el offset se mide desde x = w
            ops = (Opening("o1", OpeningKind.DOOR, w - door_at - 0.9, 0.9, 2.1),)
        walls.append(Wall(f"w{i}", Point2D(*c[i]), Point2D(*c[(i + 1) % 4]), openings=ops))
    return tuple(walls)


def level(rooms: tuple[Room, ...], walls: tuple[Wall, ...], furniture=()) -> Level:  # type: ignore[no-untyped-def]
    return Level(
        id="l1", name="Piso", elevation=0, walls=walls, rooms=rooms, furniture=tuple(furniture)
    )


def ids(fs: list[Furniture] | tuple[Furniture, ...]) -> list[str]:
    return sorted(f.catalog_id for f in fs)


def overlaps(fs: tuple[Furniture, ...]) -> bool:
    shapes = [_of(f) for f in fs]
    return any(a.intersection(b).area > 1e-6 for i, a in enumerate(shapes) for b in shapes[i + 1 :])


def test_alcoba_vacia_lleva_cama_closet_y_mesa_de_noche_sin_tapar_la_puerta() -> None:
    lv = furnish(level((box_room(RoomType.BEDROOM, 4, 3.5),), box_walls(4, 3.5, door_at=0.2)))
    assert ids(lv.furniture) == ["cama_doble", "closet", "mesa_noche"]
    doors, _ = _blocked(lv)
    room = Polygon([(0, 0), (4, 0), (4, 3.5), (0, 3.5)])
    for f in lv.furniture:
        assert room.buffer(1e-3).contains(_of(f))
        assert doors is not None and not _of(f).intersects(doors)
    assert not overlaps(lv.furniture)
    # la mesa de noche queda contra el mismo muro que la cabecera
    bed = next(f for f in lv.furniture if f.catalog_id == "cama_doble")
    night = next(f for f in lv.furniture if f.catalog_id == "mesa_noche")
    assert night.rotation == pytest.approx(bed.rotation)


def test_una_alcoba_chica_lleva_cama_sencilla() -> None:
    lv = furnish(level((box_room(RoomType.BEDROOM, 2.6, 3.0),), box_walls(2.6, 3.0)))
    assert "cama_sencilla" in ids(lv.furniture)


def test_respeta_lo_dibujado_y_solo_completa() -> None:
    drawn = Furniture("f_r1_1", "cama_doble", Point2D(2, 1.0), 1.4, 1.9, 1.0, 0.0)
    lv = level((box_room(RoomType.BEDROOM, 4, 3.5),), box_walls(4, 3.5), [drawn])
    extra = missing_furniture(lv)
    assert "cama_doble" not in ids(extra) and "cama_sencilla" not in ids(extra)
    assert furnish(lv).furniture[0] == drawn
    # y amoblar dos veces no agrega nada más
    once = furnish(lv)
    assert furnish(once) == once


def test_sala_comedor_con_cocina() -> None:
    lv = furnish(
        level(
            (box_room(RoomType.LIVING, 5, 6, "SALA-COMEDOR / COCINA"),), box_walls(5, 6, door_at=2)
        )
    )
    assert ids(lv.furniture) == ["cocina_lineal", "comedor_4", "nevera", "sofa_3"]
    assert not overlaps(lv.furniture)
    dining = next(f for f in lv.furniture if f.catalog_id == "comedor_4")
    # suelto: no toca ningún muro
    assert Polygon([(0, 0), (5, 0), (5, 6), (0, 6)]).buffer(-0.3).contains(_of(dining))


def test_lo_que_no_cabe_no_se_pone() -> None:
    lv = furnish(level((box_room(RoomType.BATHROOM, 1.0, 0.8),), box_walls(1.0, 0.8)))
    assert not overlaps(lv.furniture)
    assert "ducha" not in ids(lv.furniture)
    # un pasillo o un garaje no se amoblan
    assert furnish(level((box_room(RoomType.GARAGE, 5, 6),), box_walls(5, 6))).furniture == ()


def test_el_respaldo_mira_al_muro() -> None:
    lv = furnish(level((box_room(RoomType.STUDY, 3, 2),), box_walls(3, 2)))
    [desk] = lv.furniture
    bx, by = math.sin(desk.rotation), -math.cos(desk.rotation)
    # contra el muro más largo (y = 0 o y = 2) y mirando hacia él
    assert abs(bx) < 1e-6
    assert (by < 0) == (desk.position.y < 1)
    assert min(desk.position.y, 2 - desk.position.y) == pytest.approx(desk.depth / 2 + 0.02)

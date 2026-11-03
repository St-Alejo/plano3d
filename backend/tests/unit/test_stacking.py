"""Pisos apilados: alineación por la retícula, ids nuevos, elevaciones y escaleras."""

from __future__ import annotations

import pytest

from plano3d.domain import BuildingModel, Column, Level, Point2D, Scale, Stair, Wall
from plano3d.domain.stacking import fresh_ids, grid_offset, stack_level


def columns(dx: float = 0.0, dy: float = 0.0, extra: bool = False) -> tuple[Column, ...]:
    pts = [(x + dx, y + dy) for x in (0.15, 3.0, 5.85) for y in (0.15, 4.0, 8.0, 11.85)]
    if extra:  # un piso de arriba con una columna de más en el voladizo
        pts.append((6.6 + dx, 11.85 + dy))
    return tuple(Column(f"c{i}", Point2D(x, y)) for i, (x, y) in enumerate(pts))


def level(lid: str, dx: float = 0.0, dy: float = 0.0, extra: bool = False) -> Level:
    wall = Wall("w1", Point2D(dx, dy), Point2D(6 + dx, dy), 0.12)
    stair = Stair("s1", Point2D(1 + dx, 1 + dy), Point2D(1 + dx, 3 + dy), 0.9, 10)
    return Level(lid, lid, walls=(wall,), columns=columns(dx, dy, extra), stairs=(stair,))


def model(*levels: Level) -> BuildingModel:
    return BuildingModel("prj", Scale(0.01, "vector", 1.0), levels)


def test_la_reticula_alinea_aunque_sobre_una_columna() -> None:
    dx, dy = grid_offset(level("a"), level("b", 1.3, -0.7, extra=True))
    assert (dx, dy) == pytest.approx((-1.3, 0.7))


def test_sin_columnas_alinea_por_la_esquina_exterior() -> None:
    a = Level("a", "a", walls=(Wall("w", Point2D(1, 1), Point2D(5, 1), 0.2),))
    b = Level("b", "b", walls=(Wall("w", Point2D(3, 2), Point2D(7, 2), 0.2),))
    assert grid_offset(a, b) == pytest.approx((-2.0, -1.0))


def test_ids_nuevos_en_todo() -> None:
    lv = level("a")
    copy = fresh_ids(lv)
    old = {lv.id, *(w.id for w in lv.walls), *(c.id for c in lv.columns), "s1"}
    new = {copy.id, *(w.id for w in copy.walls), *(c.id for c in copy.columns)}
    assert not old & new
    assert copy.walls[0].start == lv.walls[0].start


def test_tres_pisos_apilados_con_escalera_continua() -> None:
    m = model(level("lvl_0"))
    m = stack_level(m, level("p2", 2.0, 3.0), "Piso 2")
    m = stack_level(m, m.levels[1], "Piso 3", align=False)
    assert [lv.elevation for lv in m.levels] == pytest.approx([0.0, 2.6, 5.2])
    assert [lv.name for lv in m.levels][1:] == ["Piso 2", "Piso 3"]
    # el piso 2 quedó sobre la retícula del 1
    assert m.levels[1].walls[0].start == Point2D(0, 0)
    ups = [lv.stairs[0].to_level_id for lv in m.levels]
    assert ups == [m.levels[1].id, m.levels[2].id, None]
    assert len({lv.id for lv in m.levels}) == 3

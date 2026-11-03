"""Escalera en U de pluma fina: tres tramos cortos con descansos, como en una casa."""

from itertools import pairwise

import pytest

from plano3d.infrastructure.vector.primitives import Line
from plano3d.infrastructure.vector.stair_flights import flight_stairs
from plano3d.infrastructure.vector.walls import (
    ColumnCand,
    OpeningCand,
    WallCand,
    grid_columns,
    split_crossed_openings,
)


def u_stair() -> list[Line]:
    """Tramo de arriba (huellas verticales en x 3,68-4,49), tramo del lado (horizontales en
    y 3,05-4,13, la primera y la última son el borde) y tramo de abajo; paso de 27 cm."""
    out = [Line(x, 2.23, x, 3.05) for x in (3.68, 3.95, 4.22, 4.49)]
    out += [Line(2.51, y, 3.41, y) for y in (3.05, 3.32, 3.59, 3.86, 4.13)]
    out += [Line(x, 4.13, x, 4.95) for x in (3.68, 3.95, 4.22, 4.49)]
    return out


def test_tres_tramos_encadenados_suben_un_piso() -> None:
    stairs, used = flight_stairs(u_stair())
    assert len(stairs) == 3 and len(used) == 13
    for a, b in pairwise(stairs):
        assert b.base == pytest.approx(a.base + a.riser * a.steps)
        # cada tramo arranca junto al descanso donde llegó el anterior
        assert abs(b.start[0] - a.end[0]) + abs(b.start[1] - a.end[1]) < 1.0
    top = stairs[-1].base + stairs[-1].riser * stairs[-1].steps
    assert top == pytest.approx(2.6)
    assert stairs[0].riser <= 0.185


def test_los_tramos_que_no_tocan_el_descanso_se_alargan_un_paso() -> None:
    stairs, _ = flight_stairs(u_stair())
    side = next(s for s in stairs if s.start[0] == s.end[0])
    assert sorted((side.start[1], side.end[1])) == pytest.approx([3.05, 4.13])
    top = next(s for s in stairs if s.start[1] < 3.0)
    # cuatro huellas en x 3,68-4,49: el tramo empieza un paso antes, en el descanso
    assert min(top.start[0], top.end[0]) == pytest.approx(3.41)


def test_un_haz_suelto_de_tres_lineas_no_es_escalera() -> None:
    shelf = [Line(1, y, 2, y) for y in (1.0, 1.3, 1.6)]
    assert flight_stairs(shelf) == ([], set())


def test_la_columna_fuera_de_la_reticula_es_un_aparato() -> None:
    grid = [ColumnCand((x, y), 0.3, 0.3, False, 0.0) for x in (0, 3, 6) for y in (0, 4)]
    sink = ColumnCand((1.4, 0.3), 0.43, 0.43, False, 0.0)
    assert grid_columns([*grid, sink]) == grid


def test_un_vano_cruzado_por_un_muro_son_dos() -> None:
    w = WallCand(0, 0, 6, 0, 0.12, openings=[OpeningCand(2.0, 1.8, "door", 0.9, "swing")])
    cross = WallCand(3.0, 0, 3.0, 2.0, 0.12)
    split_crossed_openings([w, cross])
    door, passage = w.openings
    assert door.operation == "swing" and door.width == pytest.approx(0.94)
    assert passage.operation == "none" and passage.offset == pytest.approx(3.06)

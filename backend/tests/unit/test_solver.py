"""Solver de cotas (ADR-015): la geometría queda con las medidas escritas en el plano."""

from __future__ import annotations

import pytest

from plano3d.domain import (
    Dimension,
    DimensionAxis,
    Level,
    MeasureSource,
    MeasureStatus,
    Point2D,
    Room,
    Wall,
)
from plano3d.domain.solver import solve_level

P = Point2D
H, V = DimensionAxis.HORIZONTAL, DimensionAxis.VERTICAL


def box(w: float, h: float, t: float = 0.2, dx: float = 0.0, dy: float = 0.0) -> list[Wall]:
    """Rectángulo por ejes, con un error de medición (dx, dy) en la esquina opuesta."""
    a, b, c, d = P(0, 0), P(w + dx, 0), P(w + dx, h + dy), P(0, h + dy)
    return [
        Wall("top", a, b, t),
        Wall("right", b, c, t),
        Wall("bottom", c, d, t),
        Wall("left", d, a, t),
    ]


def wall(level: Level, wid: str) -> Wall:
    return level.wall(wid)


def test_rectangulo_queda_con_sus_cotas() -> None:
    # la foto dio 4,93 x 4,07; el plano dice 5,00 x 4,00
    walls = box(5.0, 4.0, dx=-0.07, dy=0.07)
    dims = (
        Dimension("dh", P(0, -0.8), P(4.93, -0.8), 5.0, "5,00", H),
        Dimension("dv", P(-0.8, 0), P(-0.8, 4.07), 4.0, "4,00", V),
    )
    lv, rep = solve_level(Level("l", "P1", walls=tuple(walls), dimensions=dims))
    assert wall(lv, "top").length == pytest.approx(5.0, abs=1e-3)
    assert wall(lv, "right").length == pytest.approx(4.0, abs=1e-3)
    assert rep.dims_exact == 2 and rep.dims_conflict == 0
    for wid in ("top", "right", "bottom", "left"):
        m = wall(lv, wid).measure
        assert m.status is MeasureStatus.EXACT and m.source is MeasureSource.DIMENSION
    assert all(d.status is MeasureStatus.EXACT for d in lv.dimensions)
    # sigue siendo un rectángulo (las orientaciones se conservan)
    assert wall(lv, "top").start.y == pytest.approx(wall(lv, "top").end.y, abs=1e-4)


def test_cadena_de_cotas_ubica_el_tabique() -> None:
    walls = [*box(5.0, 4.0), Wall("mid", P(2.1, 0), P(2.1, 4.0), 0.12)]  # observado en 2,10
    dims = (
        Dimension("p1", P(0, -0.8), P(2.1, -0.8), 2.0, "2,00", H),
        Dimension("p2", P(2.1, -0.8), P(5.0, -0.8), 3.0, "3,00", H),
        Dimension("tot", P(0, -1.5), P(5.0, -1.5), 5.0, "5,00", H),
    )
    lv, rep = solve_level(Level("l", "P1", walls=tuple(walls), dimensions=dims))
    mid, left = wall(lv, "mid"), wall(lv, "left")
    assert mid.start.x - left.end.x == pytest.approx(2.0, abs=1e-3)  # posición relativa
    assert mid.end.x == pytest.approx(mid.start.x, abs=1e-4)  # sigue vertical
    assert rep.dims_exact == 3


def test_cadena_que_no_cierra_marca_conflicto() -> None:
    walls = [*box(5.0, 4.0), Wall("mid", P(2.0, 0), P(2.0, 4.0), 0.12)]
    dims = (
        Dimension("p1", P(0, -0.8), P(2.0, -0.8), 2.0, "2,00", H),
        Dimension("p2", P(2.0, -0.8), P(5.0, -0.8), 3.2, "3,20", H),  # 2 + 3,2 ≠ 5
        Dimension("tot", P(0, -1.5), P(5.0, -1.5), 5.0, "5,00", H),
    )
    lv, rep = solve_level(Level("l", "P1", walls=tuple(walls), dimensions=dims))
    assert rep.dims_conflict >= 1
    assert rep.max_residual > 0.05
    assert any(d.status is MeasureStatus.CONFLICT for d in lv.dimensions)


def test_cota_a_caras_luz_libre() -> None:
    """Se acotó la luz entre caras interiores (4,80) de muros de 20 cm: ejes a 5,00."""
    walls = box(5.04, 4.0)
    dims = (Dimension("luz", P(0.1, 1.0), P(4.94, 1.0), 4.80, "4,80", H),)
    lv, _ = solve_level(Level("l", "P1", walls=tuple(walls), dimensions=dims))
    assert wall(lv, "top").length == pytest.approx(5.0, abs=2e-3)


def test_una_lectura_erronea_no_arrastra() -> None:
    walls = [*box(6.0, 4.0, dx=0.04), Wall("m1", P(2.0, 0), P(2.0, 4), 0.12)]
    walls.append(Wall("m2", P(4.0, 0), P(4.0, 4), 0.12))
    dims = (
        Dimension("a", P(0, -0.8), P(2.0, -0.8), 2.0, "2,00", H),
        Dimension("b", P(2.0, -0.8), P(4.0, -0.8), 2.0, "2,00", H),
        Dimension("c", P(4.0, -0.8), P(6.04, -0.8), 2.0, "2,00", H),
        Dimension("t", P(0, -1.5), P(6.04, -1.5), 6.0, "6,00", H),
        Dimension("mal", P(0, -2.2), P(4.0, -2.2), 7.0, "7,00", H),  # OCR leyó 7 por 4
    )
    lv, rep = solve_level(Level("l", "P1", walls=tuple(walls), dimensions=dims))
    assert wall(lv, "top").length == pytest.approx(6.0, abs=0.005)
    assert wall(lv, "m2").start.x - wall(lv, "left").end.x == pytest.approx(4.0, abs=0.005)
    bad = next(d for d in lv.dimensions if d.id == "mal")
    assert bad.status is MeasureStatus.CONFLICT
    assert rep.dims_exact == 4


def test_ambientes_siguen_a_los_muros() -> None:
    walls = box(5.0, 4.0, dx=-0.1)
    room = Room("r", "SALA", (P(0.1, 0.1), P(4.8, 0.1), P(4.8, 3.9), P(0.1, 3.9)))
    dims = (Dimension("dh", P(0, -0.8), P(4.9, -0.8), 5.0, "5,00", H),)
    lv, _ = solve_level(Level("l", "P1", walls=tuple(walls), rooms=(room,), dimensions=dims))
    xs = sorted(p.x for p in lv.rooms[0].polygon)
    # la cara interior del muro derecho sigue al muro: el ancho libre crece 10 cm
    assert xs[-1] - xs[0] == pytest.approx(4.7 + 0.1, abs=0.01)


def test_sin_cotas_no_cambia_nada() -> None:
    lv = Level("l", "P1", walls=tuple(box(5.0, 4.0)))
    out, rep = solve_level(lv)
    assert out == lv and rep.dims_exact == 0


def test_cota_sin_muros_cerca_queda_sin_enlazar() -> None:
    walls = box(5.0, 4.0)
    dims = (Dimension("x", P(10, 10), P(12, 10), 2.0, "2,00", H),)
    _, rep = solve_level(Level("l", "P1", walls=tuple(walls), dimensions=dims))
    assert rep.dims_unlinked == 1

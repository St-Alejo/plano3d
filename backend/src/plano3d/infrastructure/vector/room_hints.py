"""Nombre de un ambiente sin rótulo, por lo que tiene dibujado adentro.

Las láminas no rotulan los baños pequeños ni el punto fijo: el sanitario y el lavamanos
(arcos de 10 a 45 cm) dicen que es un baño, y las huellas parejas que es la escalera.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from shapely.geometry import Point, Polygon

from plano3d.domain import RoomType
from plano3d.infrastructure.vector.primitives import ArcPrim, Line

#: un baño sin rótulo es pequeño; uno mayor con lavamanos puede ser cocina o ropas
BATH_MAX_M2 = 6.0
FIXTURE_R_M = (0.1, 0.45)
#: barrido mínimo (rad) del arco de un aparato: los de menos son trozos de hoja o de texto
FIXTURE_SWEEP = 1.0
#: huellas: largo mínimo, paso entre 18 y 40 cm, y cuántas seguidas hacen una escalera
TREAD_MIN_M = 0.5
TREAD_STEP_M = (0.18, 0.40)
TREAD_STEP_TOL_M = 0.05
#: en fotos una huella sale cortada o doble: largo parecido y trazos muy juntos son uno
TREAD_LEN_TOL = 0.35
TREAD_DOUBLE_M = 0.06
TREAD_ANGLE_DEG = 4.0
MIN_TREADS = 4


def _angle(ln: Line) -> float:
    return math.degrees(math.atan2(ln.y2 - ln.y1, ln.x2 - ln.x1))


def _even_run(offsets: list[float]) -> int:
    """Cuántas huellas seguidas con el mismo paso hay en ``offsets`` (ordenados)."""
    best = min(1, len(offsets))
    for i in range(len(offsets)):
        n, step = 1, None
        for a, b in zip(offsets[i:], offsets[i + 1 :], strict=False):
            gap = b - a
            if not TREAD_STEP_M[0] <= gap <= TREAD_STEP_M[1]:
                break
            if step is not None and abs(gap - step) > TREAD_STEP_TOL_M:
                break
            step = step if step is not None else gap
            n += 1
        best = max(best, n)
    return best


def tread_count(lines: Sequence[Line]) -> int:
    """El haz más largo de huellas: paralelas, de largo parecido, alineadas y equiespaciadas."""
    long = [ln for ln in lines if ln.length >= TREAD_MIN_M]
    best = 0
    for a in long:
        ux, uy = a.direction
        offsets = []
        for b in long:
            diff = abs((_angle(b) - _angle(a) + 90) % 180 - 90)
            if diff > TREAD_ANGLE_DEG or abs(b.length - a.length) > TREAD_LEN_TOL * a.length:
                continue
            mx, my = (b.x1 + b.x2) / 2 - a.x1, (b.y1 + b.y2) / 2 - a.y1
            if abs(mx * ux + my * uy - a.length / 2) > a.length / 4:
                continue  # otra columna de líneas, no el mismo tramo
            offsets.append(mx * -uy + my * ux)
        merged: list[float] = []
        for o in sorted(offsets):
            if not merged or o - merged[-1] > TREAD_DOUBLE_M:
                merged.append(o)
        best = max(best, _even_run(merged))
    return best


def _has_fixture(arcs: Sequence[ArcPrim]) -> bool:
    return any(
        FIXTURE_R_M[0] <= a.r <= FIXTURE_R_M[1] and abs(a.sweep) >= FIXTURE_SWEEP for a in arcs
    )


def hinted_type(poly: Polygon, lines: Sequence[Line], arcs: Sequence[ArcPrim]) -> RoomType | None:
    """Tipo de un ambiente sin nombre (metros) según los trazos que caen adentro."""
    inside_lines = [
        ln for ln in lines if poly.contains(Point((ln.x1 + ln.x2) / 2, (ln.y1 + ln.y2) / 2))
    ]
    if tread_count(inside_lines) >= MIN_TREADS:
        return RoomType.STAIRS
    inside_arcs = [a for a in arcs if poly.contains(Point(a.cx, a.cy))]
    if poly.area <= BATH_MAX_M2 and _has_fixture(inside_arcs):
        return RoomType.BATHROOM
    return None


HINT_LABELS = {RoomType.STAIRS: "Escalera", RoomType.BATHROOM: "Baño"}

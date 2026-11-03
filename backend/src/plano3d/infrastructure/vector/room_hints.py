"""Nombre de un ambiente sin rótulo, por lo que tiene dibujado adentro.

Las láminas no rotulan los baños pequeños ni el punto fijo: el sanitario y el lavamanos
(arcos de 10 a 45 cm) dicen que es un baño, y las huellas parejas que es la escalera.
Si la escalera ocupa menos de la mitad del ambiente, este es el hall que la recibe; un
ambiente grande con un portón en la fachada es un parqueadero.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

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
#: la escalera ocupa al menos esta fracción del punto fijo; en menos, es un hall
STAIR_SHARE = 0.45
GARAGE_MIN_M2 = 12.0
#: el portón queda sobre el borde del ambiente (la mitad del muro de fachada y algo)
GATE_REACH_M = 0.3
#: un ambiente angosto y alargado sin aparatos es un pasillo
CORRIDOR_MAX_M = 1.3
CORRIDOR_RATIO = 1.4


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


def hinted_type(
    poly: Polygon,
    lines: Sequence[Line],
    arcs: Sequence[ArcPrim],
    flights: Sequence[Polygon] = (),
    gates: Sequence[LineString] = (),
) -> RoomType | None:
    """Tipo de un ambiente sin nombre (metros) según los trazos que caen adentro.

    ``flights``: huellas en planta de los tramos de escalera ya detectados; ``gates``: los
    portones de la fachada."""
    if flights:
        # la caja de la escalera: los tramos y los descansos entre ellos
        well = unary_union(list(flights)).convex_hull
        stair = well.intersection(poly).area
        if stair > 0.5 * well.area:
            return RoomType.STAIRS if stair >= STAIR_SHARE * poly.area else RoomType.CIRCULATION
    inside_lines = [
        ln for ln in lines if poly.contains(Point((ln.x1 + ln.x2) / 2, (ln.y1 + ln.y2) / 2))
    ]
    if tread_count(inside_lines) >= MIN_TREADS:
        return RoomType.STAIRS
    if poly.area >= GARAGE_MIN_M2 and any(
        poly.exterior.distance(Point(g.interpolate(0.5, normalized=True))) <= GATE_REACH_M
        for g in gates
    ):
        return RoomType.GARAGE
    inside_arcs = [a for a in arcs if poly.contains(Point(a.cx, a.cy))]
    if poly.area <= BATH_MAX_M2 and _has_fixture(inside_arcs):
        return RoomType.BATHROOM
    short, long = _sides(poly)
    if short <= CORRIDOR_MAX_M and long >= CORRIDOR_RATIO * short:
        return RoomType.CIRCULATION
    return None


def _sides(poly: Polygon) -> tuple[float, float]:
    xs, ys = poly.minimum_rotated_rectangle.exterior.coords.xy
    a = math.dist((xs[0], ys[0]), (xs[1], ys[1]))
    b = math.dist((xs[1], ys[1]), (xs[2], ys[2]))
    return min(a, b), max(a, b)


def hint_label(room_type: RoomType, poly: Polygon) -> str:
    """Nombre del ambiente sin rótulo: la circulación angosta es un pasillo."""
    if room_type is RoomType.CIRCULATION and _sides(poly)[0] <= CORRIDOR_MAX_M:
        return "Pasillo"
    return HINT_LABELS[room_type]


HINT_LABELS = {
    RoomType.STAIRS: "Escalera",
    RoomType.CIRCULATION: "Hall",
    RoomType.GARAGE: "Parqueadero",
    RoomType.BATHROOM: "Baño",
}

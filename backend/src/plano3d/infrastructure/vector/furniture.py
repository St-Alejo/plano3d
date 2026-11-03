"""Muebles dibujados en el plano vectorial (camas, closets, cocina, comedor, sofá, aparatos).

En los planos CAD los muebles son trazos de detalle dentro de los ambientes. Un mueble
"de caja" (cama, closet, mesón, mesa, sofá, ducha) es un rectángulo: dos pares de lados
paralelos que se cierran. ``find_rects`` los arma con tolerancia de dibujo, y
``detect_furniture`` decide qué es cada uno según su tamaño y el tipo de ambiente (una
cama solo se busca en una alcoba). Los aparatos redondos del baño (sanitario, lavamanos)
se reconocen por sus arcos.

Lo que no se reconoce se ignora: ``domain/furnish.py`` completa después por tipo de ambiente.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass

from shapely.geometry import LineString, Point, Polygon

from plano3d.domain import Furniture, Point2D, Room, RoomType, Wall
from plano3d.infrastructure.vector.primitives import ArcPrim, Line

#: tolerancia de dibujo para que dos lados "se toquen" (m)
TOL = 0.05
MIN_SIDE = 0.3
MAX_SIDE = 4.6
#: dos lados son paralelos si su ángulo difiere menos que esto (rad)
ANGLE_TOL = math.radians(2.0)


@dataclass(frozen=True)
class Rect:
    cx: float
    cy: float
    #: lado corto y largo (m)
    w: float
    length: float
    #: dirección del lado largo (rad)
    angle: float

    @property
    def area(self) -> float:
        return self.w * self.length

    def polygon(self) -> Polygon:
        ux, uy = math.cos(self.angle), math.sin(self.angle)
        vx, vy = -uy, ux
        hl, hw = self.length / 2, self.w / 2
        return Polygon(
            [
                (self.cx + s * ux * hl + t * vx * hw, self.cy + s * uy * hl + t * vy * hw)
                for s, t in ((-1, -1), (1, -1), (1, 1), (-1, 1))
            ]
        )


def _angle(ln: Line) -> float:
    return math.atan2(ln.y2 - ln.y1, ln.x2 - ln.x1) % math.pi


def _covered(segment: LineString, lines: list[Line], angle: float) -> bool:
    """¿Algún trazo (paralelo a ``angle``) cubre al menos el 80 % del segmento?"""
    need = segment.length * 0.8
    for ln in lines:
        if abs(((_angle(ln) - angle + math.pi / 2) % math.pi) - math.pi / 2) > ANGLE_TOL * 2:
            continue
        g = LineString([(ln.x1, ln.y1), (ln.x2, ln.y2)])
        if g.distance(segment) > TOL:
            continue
        if segment.buffer(TOL, cap_style="flat").intersection(g).length >= need:
            return True
    return False


def merge_collinear(lines: Iterable[Line]) -> list[Line]:
    """Une los trazos alineados que se tocan: el CAD parte un lado donde lo cruza otro."""
    groups: list[tuple[float, float, list[tuple[float, float]]]] = []
    for ln in lines:
        a = _angle(ln)
        ux, uy = math.cos(a), math.sin(a)
        off = -ln.x1 * uy + ln.y1 * ux
        s0, s1 = sorted((ln.x1 * ux + ln.y1 * uy, ln.x2 * ux + ln.y2 * uy))
        for ga, goff, spans in groups:
            if (
                abs(((a - ga + math.pi / 2) % math.pi) - math.pi / 2) <= ANGLE_TOL
                and abs(off - goff) <= TOL / 2
            ):
                spans.append((s0, s1))
                break
        else:
            groups.append((a, off, [(s0, s1)]))
    out: list[Line] = []
    for a, off, spans in groups:
        ux, uy = math.cos(a), math.sin(a)
        spans.sort()
        merged = [list(spans[0])]
        for s0, s1 in spans[1:]:
            if s0 <= merged[-1][1] + TOL / 2:
                merged[-1][1] = max(merged[-1][1], s1)
            else:
                merged.append([s0, s1])
        for s0, s1 in merged:
            out.append(
                Line(s0 * ux - off * uy, s0 * uy + off * ux, s1 * ux - off * uy, s1 * uy + off * ux)
            )
    return out


def find_rects(lines: Iterable[Line]) -> list[Rect]:
    """Rectángulos cerrados formados por los trazos (sin duplicados ni casi iguales)."""
    ls = [ln for ln in merge_collinear(lines) if ln.length >= MIN_SIDE - TOL]
    out: list[Rect] = []
    for i, a in enumerate(ls):
        aa = _angle(a)
        ux, uy = math.cos(aa), math.sin(aa)
        vx, vy = -uy, ux
        a0 = a.x1 * ux + a.y1 * uy
        a1 = a.x2 * ux + a.y2 * uy
        a0, a1 = min(a0, a1), max(a0, a1)
        av = a.x1 * vx + a.y1 * vy
        for b in ls[i + 1 :]:
            d_ang = abs(((_angle(b) - aa + math.pi / 2) % math.pi) - math.pi / 2)
            if d_ang > ANGLE_TOL:
                continue
            b0 = b.x1 * ux + b.y1 * uy
            b1 = b.x2 * ux + b.y2 * uy
            b0, b1 = min(b0, b1), max(b0, b1)
            # los dos lados del mismo largo y alineados en sus extremos
            if abs(a0 - b0) > TOL or abs(a1 - b1) > TOL:
                continue
            off = (b.x1 * vx + b.y1 * vy) - av
            if not MIN_SIDE <= abs(off) <= MAX_SIDE:
                continue
            s0, s1 = (a0 + b0) / 2, (a1 + b1) / 2
            bv = av + off

            def pt(
                s: float, v: float, ux: float = ux, uy: float = uy, vx: float = vx, vy: float = vy
            ) -> tuple[float, float]:
                return (s * ux + v * vx, s * uy + v * vy)

            perp = (aa + math.pi / 2) % math.pi
            if not (
                _covered(LineString([pt(s0, av), pt(s0, bv)]), ls, perp)
                and _covered(LineString([pt(s1, av), pt(s1, bv)]), ls, perp)
            ):
                continue
            length, width = s1 - s0, abs(off)
            cx, cy = pt((s0 + s1) / 2, av + off / 2)
            angle = aa if length >= width else perp
            out.append(Rect(cx, cy, min(length, width), max(length, width), angle))
    # sin repetidos (un mismo rectángulo hallado por pares distintos)
    uniq: list[Rect] = []
    for r in sorted(out, key=lambda r: -r.area):
        if not any(
            math.hypot(r.cx - u.cx, r.cy - u.cy) < TOL
            and abs(r.w - u.w) < TOL
            and abs(r.length - u.length) < TOL
            for u in uniq
        ):
            uniq.append(r)
    return uniq


# ----------------------------------------------------------------------------- clasificación


@dataclass(frozen=True)
class _Kind:
    catalog_id: str
    w: tuple[float, float]
    length: tuple[float, float]
    height: float
    #: va contra un muro (el respaldo mira al muro más cercano)
    wall: bool = True
    #: el respaldo va en un lado corto (la cabecera de la cama) o en uno largo
    short_back: bool = False


_BY_ROOM: dict[RoomType, tuple[_Kind, ...]] = {
    RoomType.BEDROOM: (
        _Kind("cama_doble", (1.25, 2.05), (1.85, 2.25), 1.0, short_back=True),
        _Kind("cama_sencilla", (0.85, 1.25), (1.85, 2.1), 1.0, short_back=True),
        _Kind("closet", (0.5, 0.72), (0.9, 3.2), 2.2),
        _Kind("escritorio", (0.45, 0.7), (0.8, 1.6), 0.75),
    ),
    # el mesón de una sala-comedor con cocina sale de la estufa y el lavaplatos (_counters):
    # un rectángulo largo y angosto ahí es el sofá
    RoomType.LIVING: (
        # la mesa sola (las sillas son rectángulos aparte): el mueble suma las sillas
        _Kind("comedor_4", (0.75, 1.3), (0.75, 2.0), 0.9, wall=False),
        _Kind("sofa_3", (0.55, 1.0), (1.7, 2.6), 0.82),
        _Kind("sofa_2", (0.55, 1.0), (1.3, 1.7), 0.82),
    ),
    RoomType.KITCHEN: (
        _Kind("cocina_lineal", (0.5, 0.72), (1.2, 4.2), 0.91),
        _Kind("nevera", (0.6, 0.8), (0.6, 0.85), 1.8),
    ),
    RoomType.BATHROOM: (_Kind("ducha", (0.75, 1.3), (0.75, 1.6), 2.0, wall=False),),
}
#: una sala-comedor con cocina también tiene la cocina
_ALIASES = {RoomType.KITCHEN: RoomType.LIVING}


def _back_rotation(
    r: Rect, walls: list[LineString], short_back: bool
) -> tuple[float, float, float]:
    """(rotación, ancho, fondo) con el respaldo (-z local) hacia el muro más cercano.

    Se prueban los 2 lados largos (sofá, closet: ancho = largo) o los 2 cortos (cama: la
    cabecera). En planta el respaldo local apunta a (sen r, -cos r).
    """
    ux, uy = math.cos(r.angle), math.sin(r.angle)
    vx, vy = -uy, ux
    sides = (
        ((ux, uy, r.w, r.length), (-ux, -uy, r.w, r.length))
        if short_back
        else ((vx, vy, r.length, r.w), (-vx, -vy, r.length, r.w))
    )
    best: tuple[float, float, float, float] | None = None
    for nx, ny, width, depth in sides:
        p = Point(r.cx + nx * (depth / 2 + 0.15), r.cy + ny * (depth / 2 + 0.15))
        dist = min((w.distance(p) for w in walls), default=9.0)
        if best is None or dist < best[0]:
            best = (dist, math.atan2(nx, -ny), width, depth)
    assert best is not None
    return best[1], best[2], best[3]


def _fits(v: float, rng: tuple[float, float]) -> bool:
    return rng[0] <= v <= rng[1]


def detect_furniture(
    rooms: Iterable[Room],
    walls: Iterable[Wall],
    lines: Iterable[Line],
    arcs: Iterable[ArcPrim] = (),
) -> list[Furniture]:
    """Muebles reconocidos en los trazos de detalle de cada ambiente."""
    wall_lines = [LineString([(w.start.x, w.start.y), (w.end.x, w.end.y)]) for w in walls]
    all_lines = list(lines)
    all_arcs = list(arcs)
    out: list[Furniture] = []
    for room in rooms:
        kinds = _BY_ROOM.get(room.room_type) or _BY_ROOM.get(
            _ALIASES.get(room.room_type, room.room_type), ()
        )
        if room.room_type is RoomType.LIVING and "COCINA" in room.label.upper():
            kinds = _BY_ROOM[RoomType.LIVING]
        poly = Polygon([(p.x, p.y) for p in room.polygon])
        inner = poly.buffer(-0.02)
        if inner.is_empty:
            continue
        mine = [
            ln
            for ln in all_lines
            if inner.contains(Point((ln.x1 + ln.x2) / 2, (ln.y1 + ln.y2) / 2))
        ]
        taken: list[Polygon] = []
        small: list[Rect] = []
        n = 0
        for r in find_rects(mine) if kinds else []:
            rp = r.polygon()
            if not poly.buffer(0.05).contains(rp):
                continue
            kind = next((k for k in kinds if _fits(r.w, k.w) and _fits(r.length, k.length)), None)
            if any(rp.intersection(t).area > 0.3 * min(rp.area, t.area) for t in taken):
                continue
            if kind is None:
                if _fits(r.w, _MARK) and _fits(r.length, _MARK):
                    small.append(r)
                continue
            if kind.wall:
                rot, width, depth = _back_rotation(r, wall_lines, kind.short_back)
            else:
                # suelto: el x local sigue el lado largo; el comedor suma una silla por lado
                rot, width, depth = (
                    r.angle,
                    r.length,
                    r.w + (0.8 if kind.catalog_id == "comedor_4" else 0.0),
                )
            taken.append(_footprint(r.cx, r.cy, rot, width, depth))
            n += 1
            out.append(
                Furniture(
                    f"f_{room.id}_{n}",
                    kind.catalog_id,
                    Point2D(r.cx, r.cy),
                    width,
                    depth,
                    kind.height,
                    rot,
                )
            )
        if room.room_type is RoomType.KITCHEN or "COCINA" in room.label.upper():
            counters = _counters(
                room,
                poly,
                [r for r in small if not any(r.polygon().intersects(t) for t in taken)],
                start=n,
            )
            n += len(counters)
            out += counters
        if room.room_type is RoomType.BATHROOM:
            out += _fixtures(room, poly, all_arcs, wall_lines, start=n)
    return out


#: estufa, lavaplatos o nevera dibujados como un recuadro pequeño sobre el mesón
_MARK = (0.35, 0.7)
COUNTER_DEPTH = 0.6
COUNTER_MIN = 1.8


def _footprint(cx: float, cy: float, rot: float, width: float, depth: float) -> Polygon:
    """Huella en planta de un mueble (x local = (cos r, sen r))."""
    return Rect(
        cx, cy, min(width, depth), max(width, depth), rot if width >= depth else rot + math.pi / 2
    ).polygon()


def _counters(room: Room, poly: Polygon, marks: list[Rect], start: int) -> list[Furniture]:
    """Mesón de cocina: el contorno del mesón casi nunca cierra (lo cortan el muro y la
    ventana), pero la estufa y el lavaplatos sí. Cada muro con aparatos lleva su mesón,
    centrado en ellos y de al menos 1,8 m, con el fondo contra ese muro."""
    ring = poly.exterior
    groups: dict[int, list[tuple[float, Rect]]] = {}
    coords = list(ring.coords)
    for r in marks:
        c = Point(r.cx, r.cy)
        if ring.distance(c) > 0.5:
            continue
        # el lado del ambiente más cercano: allí va el mesón
        i = min(range(len(coords) - 1), key=lambda k: LineString(coords[k : k + 2]).distance(c))
        edge = LineString(coords[i : i + 2])
        groups.setdefault(i, []).append((edge.project(c), r))
    out: list[Furniture] = []
    n = start
    for i, items in sorted(groups.items()):
        edge = LineString(coords[i : i + 2])
        (ax, ay), (bx, by) = coords[i], coords[i + 1]
        ux, uy = (bx - ax) / edge.length, (by - ay) / edge.length
        # normal hacia adentro del ambiente
        nx, ny = -uy, ux
        mx, my = (ax + bx) / 2 + nx * 0.05, (ay + by) / 2 + ny * 0.05
        if not poly.contains(Point(mx, my)):
            nx, ny = -nx, -ny
        lo = min(s for s, _ in items) - 0.45
        hi = max(s for s, _ in items) + 0.45
        if hi - lo < COUNTER_MIN:
            mid = (lo + hi) / 2
            lo, hi = mid - COUNTER_MIN / 2, mid + COUNTER_MIN / 2
        lo, hi = max(lo, 0.0), min(hi, edge.length)
        if hi - lo < 1.0:
            continue
        s = (lo + hi) / 2
        cx = ax + ux * s + nx * COUNTER_DEPTH / 2
        cy = ay + uy * s + ny * COUNTER_DEPTH / 2
        n += 1
        # el respaldo (-z local, en planta (sen r, -cos r)) mira al muro: -n
        out.append(
            Furniture(
                f"f_{room.id}_{n}",
                "cocina_lineal",
                Point2D(cx, cy),
                hi - lo,
                COUNTER_DEPTH,
                0.91,
                math.atan2(-nx, ny),
            )
        )
    return out


def _fixtures(
    room: Room, poly: Polygon, arcs: list[ArcPrim], walls: list[LineString], start: int
) -> list[Furniture]:
    """Sanitario y lavamanos: arcos de 0,15 a 0,3 m dentro del baño, pegados a un muro."""
    out: list[Furniture] = []
    used: list[Point] = []
    n = start
    for a in sorted(arcs, key=lambda a: -a.r):
        c = Point(a.cx, a.cy)
        if (
            not 0.14 <= a.r <= 0.32
            or not poly.contains(c)
            or any(c.distance(u) < 0.45 for u in used)
        ):
            continue
        dist, wall = min(
            ((w.distance(c), w) for w in walls), key=lambda t: t[0], default=(9.0, None)
        )
        if wall is None or dist > 0.75:
            continue
        # el respaldo mira al muro: normal desde el centro hacia el punto más cercano del muro
        q = wall.interpolate(wall.project(c))
        nx, ny = q.x - c.x, q.y - c.y
        k = math.hypot(nx, ny) or 1.0
        nx, ny = nx / k, ny / k
        rot = math.atan2(nx, -ny)
        has_toilet = any(f.catalog_id == "sanitario" for f in out)
        catalog_id, w, d, h = (
            ("lavamanos", 0.55, 0.45, 0.85) if has_toilet else ("sanitario", 0.4, 0.7, 0.78)
        )
        n += 1
        # el centro del aparato: la mitad de su fondo separada del muro
        px, py = q.x - nx * (d / 2 + 0.06), q.y - ny * (d / 2 + 0.06)
        out.append(Furniture(f"f_{room.id}_{n}", catalog_id, Point2D(px, py), w, d, h, rot))
        used.append(c)
        if len(out) >= 2:
            break
    return out

"""Escaleras en L o en U dibujadas con pluma fina: tramos cortos de huellas.

Una lámina de casa dibuja el punto fijo con líneas de detalle y en tramos de 3 a 5 huellas
que doblan en los descansos. Ninguno llega a las 5 líneas que pide ``find_stairs``, pero
dos o más tramos vecinos sí son una escalera (o un tramo recto de 5 o más). Cada tramo
sale como un ``StairCand`` recto, el siguiente arranca donde llegó el anterior (``base``)
y la contrahuella reparte la altura del piso entre todos los peldaños.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from plano3d.infrastructure.vector.primitives import Line, Pt
from plano3d.infrastructure.vector.walls import StairCand

#: huellas: largo, paso (las líneas de una ventana van a 10-15 cm) y cuánto pueden diferir
#: los extremos de las líneas de un tramo
TREAD_LEN_M = (0.6, 1.5)
STEP_M = (0.20, 0.40)
STEP_TOL_M = 0.03
END_TOL_M = 0.05
ANGLE_DEG = 2.0
MIN_LINES = 3
DOUBLE_M = 0.06
#: dos tramos de la misma escalera quedan a menos de esto: el descanso, de un ancho
NEIGHBOR_M = 1.0
#: una escalera de pluma fina necesita al menos esto entre todos sus tramos
MIN_GROUP_LINES = 8
#: un tramo recto solo, como en ``find_stairs``
MIN_STRAIGHT_LINES = 5
LEVEL_HEIGHT_M = 2.6
MAX_RISER_M = 0.185


@dataclass
class _Flight:
    ids: list[int]
    u: Pt  # dirección de subida (a lo largo del paso)
    lo: float  # primera y última huella sobre ``u`` (desde ``origin``)
    hi: float
    step: float
    origin: Pt
    d: Pt  # dirección de la huella
    a: float  # extremos de las huellas sobre ``d``
    b: float
    width: float

    def point(self, s: float) -> Pt:
        """Punto de la línea de huella (en el centro del ancho) a ``s`` sobre ``u``."""
        return self._at(s, (self.a + self.b) / 2)

    def _at(self, s: float, t: float) -> Pt:
        (ux, uy), (dx, dy) = self.u, self.d
        return (self.origin[0] + ux * s + dx * t, self.origin[1] + uy * s + dy * t)

    def box(self) -> tuple[float, float, float, float]:
        pts = [self._at(s, t) for s in (self.lo, self.hi) for t in (self.a, self.b)]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        return min(xs), min(ys), max(xs), max(ys)


def _box_gap(p: tuple[float, float, float, float], q: tuple[float, float, float, float]) -> float:
    dx = max(q[0] - p[2], p[0] - q[2], 0.0)
    dy = max(q[1] - p[3], p[1] - q[3], 0.0)
    return math.hypot(dx, dy)


def _flights(lines: Sequence[Line]) -> list[_Flight]:
    """Haces de ≥ 3 huellas paralelas, de igual largo y extremos, con paso constante."""
    cand = [i for i, ln in enumerate(lines) if TREAD_LEN_M[0] <= ln.length <= TREAD_LEN_M[1]]
    used: set[int] = set()
    out: list[_Flight] = []
    for i in cand:
        if i in used:
            continue
        a = lines[i]
        d = a.direction  # a lo largo de la huella
        n = (-d[1], d[0])  # dirección del paso
        rows: list[tuple[float, int]] = []
        for j in cand:
            if j in used:
                continue
            b = lines[j]
            diff = abs((b.angle - a.angle + 90) % 180 - 90)
            if diff > ANGLE_DEG or abs(b.length - a.length) > END_TOL_M:
                continue
            s1, s2 = sorted(
                (
                    (b.x1 - a.x1) * d[0] + (b.y1 - a.y1) * d[1],
                    (b.x2 - a.x1) * d[0] + (b.y2 - a.y1) * d[1],
                )
            )
            if abs(s1) > END_TOL_M or abs(s2 - a.length) > END_TOL_M:
                continue
            rows.append(((b.x1 - a.x1) * n[0] + (b.y1 - a.y1) * n[1], j))
        rows.sort()
        run = _even_run(rows)
        if len(run) < MIN_LINES:
            continue
        used.update(j for _, j in run)
        step = (run[-1][0] - run[0][0]) / (len(run) - 1)
        out.append(
            _Flight(
                [j for _, j in run],
                n,
                run[0][0],
                run[-1][0],
                step,
                (a.x1, a.y1),
                d,
                0.0,
                a.length,
                a.length,
            )
        )
    return out


def _even_run(rows: list[tuple[float, int]]) -> list[tuple[float, int]]:
    best: list[tuple[float, int]] = []
    for k in range(len(rows)):
        run = [rows[k]]
        step: float | None = None
        for r in rows[k + 1 :]:
            g = r[0] - run[-1][0]
            if g <= DOUBLE_M:
                continue  # trazo doble
            # una línea entre dos huellas (las de una ventana, a 10 cm) no es escalera
            if g < STEP_M[0] or g > STEP_M[1] or (step is not None and abs(g - step) > STEP_TOL_M):
                break
            step = step if step is not None else g
            run.append(r)
        if len(run) > len(best):
            best = run
    return best


def _groups(flights: list[_Flight]) -> list[list[_Flight]]:
    groups: list[list[_Flight]] = []
    for f in flights:
        near = [g for g in groups if any(_box_gap(f.box(), h.box()) <= NEIGHBOR_M for h in g)]
        merged = [f]
        for g in near:
            merged += g
            groups.remove(g)
        groups.append(merged)
    return groups


def _reach_neighbors(f: _Flight, others: list[_Flight]) -> None:
    """Un tramo que no toca al vecino (la huella del borde es su contorno) se alarga un paso."""
    boxes = [o.box() for o in others]
    for end in (0, 1):
        s = f.hi if end else f.lo
        sign = 1 if end else -1
        p = f.point(s)
        q = f.point(s + sign * f.step)
        here = min((_box_gap((*p, *p), b) for b in boxes), default=math.inf)
        ahead = min((_box_gap((*q, *q), b) for b in boxes), default=math.inf)
        if ahead < here and here > f.step / 2:
            if end:
                f.hi += f.step
            else:
                f.lo -= f.step


def _chain(group: list[_Flight]) -> list[tuple[_Flight, bool]]:
    """Orden de subida: cada tramo empieza junto a donde acabó el anterior.

    Devuelve (tramo, invertido): invertido si se sube de ``hi`` a ``lo``."""

    def ends(f: _Flight) -> tuple[Pt, Pt]:
        return f.point(f.lo), f.point(f.hi)

    def links(f: _Flight) -> int:
        return sum(
            min(math.dist(e, x) for x in ends(o)) <= 1.2
            for o in group
            if o is not f
            for e in ends(f)
        )

    rest = sorted(group, key=lambda f: (links(f), f.box()[1], f.box()[0]))
    first = rest.pop(0)
    lo, hi = ends(first)
    others = [e for o in rest for e in ends(o)]
    # se arranca por el extremo libre: el más lejos de los demás tramos
    flip = bool(others) and min(math.dist(lo, x) for x in others) < min(
        math.dist(hi, x) for x in others
    )
    out = [(first, flip)]
    tip = lo if flip else hi
    while rest:
        nxt = min(rest, key=lambda o: min(math.dist(tip, x) for x in ends(o)))
        rest.remove(nxt)
        lo, hi = ends(nxt)
        flip = math.dist(tip, hi) < math.dist(tip, lo)
        out.append((nxt, flip))
        tip = lo if flip else hi
    return out


def flight_stairs(
    lines: Sequence[Line], height: float = LEVEL_HEIGHT_M
) -> tuple[list[StairCand], set[int]]:
    """Escaleras de varios tramos cortos entre ``lines`` (las de detalle) y sus índices."""
    stairs: list[StairCand] = []
    used: set[int] = set()
    for group in _groups(_flights(lines)):
        lines_in = sum(len(f.ids) for f in group)
        if lines_in < (MIN_GROUP_LINES if len(group) > 1 else MIN_STRAIGHT_LINES):
            continue
        for f in group:
            _reach_neighbors(f, [o for o in group if o is not f])
        chain = _chain(group)

        def steps(f: _Flight) -> int:
            # un peldaño más que huellas: el que sube al descanso o al piso
            return round((f.hi - f.lo) / f.step) + 1

        if len(chain) > 1 and height / sum(steps(f) for f, _ in chain) > MAX_RISER_M:
            # contrahuella muy alta: la primera y la última huella libres son peldaños
            # dibujados como el borde del vacío; los tramos de los extremos se alargan
            for f, flip in (chain[0], chain[-1]):
                at_start = f is chain[0][0]
                if at_start != flip:
                    f.lo -= f.step
                else:
                    f.hi += f.step
        riser = height / sum(steps(f) for f, _ in chain)
        base = 0.0
        for f, flip in chain:
            start, end = f.point(f.lo), f.point(f.hi)
            if flip:
                start, end = end, start
            stairs.append(StairCand(start, end, f.width, steps(f), riser=riser, base=base))
            base += riser * steps(f)
            used.update(f.ids)
    return stairs, used

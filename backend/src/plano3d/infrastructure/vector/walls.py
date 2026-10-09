"""De líneas a muros: el corazón del importador vectorial (funciones puras, en metros).

1. **Escaleras primero**: un haz de ≥ 5 líneas paralelas, iguales y equiespaciadas son
   huellas; se apartan para que no se confundan con muros.
2. **Pares de caras**: dos líneas paralelas a una distancia de espesor de muro
   (5 a 65 cm) que se solapan forman un tramo de muro: eje en la mitad, espesor = distancia.
   Igual con dos arcos concéntricos → muro curvo.
3. **Cadenas colineales**: los tramos sobre la misma recta se unen. Un hueco del tamaño de
   un encuentro en T se cierra; uno de 45 cm a 3 m es una ABERTURA. Es ventana si hay
   líneas finas dentro de la banda del muro (o un tramo "delgado" entre dos gruesos); es
   puerta si hay un arco de giro con centro en una jamba (de ahí bisagra y sentido).
4. **Topología**: los extremos se llevan a la intersección con el muro que tocan.
5. **Ambientes**: cada agujero de la unión de las huellas de los muros (vanos cerrados).
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

import numpy as np
from shapely.geometry import LineString, MultiPoint, Point, Polygon
from shapely.ops import unary_union

from plano3d.infrastructure.vector.primitives import ArcPrim, Closed, Insert, Line, Pt, block_kind

T_MIN = 0.05
T_MAX = 0.65
ANGLE_TOL = 1.0  # grados


@dataclass(frozen=True)
class Tol:
    """Tolerancias del núcleo: estrictas para CAD (DXF/PDF), holgadas para fotos."""

    angle: float = ANGLE_TOL  # grados entre caras "paralelas"
    parallel: float = 0.02  # m: cuánto pueden diferir las distancias de los dos extremos
    concentric: float = 0.02  # m: distancia entre centros de arcos de un mismo muro
    join: float = 0.003  # m: dos extremos a menos de esto son el mismo punto
    #: grados: alinear tramos a las direcciones dominantes del edificio (0 = no)
    regularize: float = 0.0
    #: un extremo se une al muro que toca si está a menos de ``snap`` espesores
    snap: float = 1.25


CAD = Tol()
MIN_OPENING = 0.45
MAX_OPENING = 3.0


def _dot(a: Pt, b: Pt) -> float:
    return a[0] * b[0] + a[1] * b[1]


def _sub(a: Pt, b: Pt) -> Pt:
    return (a[0] - b[0], a[1] - b[1])


def _angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


# ----------------------------------------------------------------------------- tipos


@dataclass
class OpeningCand:
    offset: float  # metros desde el inicio del muro
    width: float
    kind: str  # door | window
    confidence: float = 0.9
    operation: str | None = None
    hinge_at_end: bool = False
    opens_left: bool = True


@dataclass
class WallCand:
    x1: float
    y1: float
    x2: float
    y2: float
    thickness: float
    bulge: float = 0.0
    openings: list[OpeningCand] = field(default_factory=list)
    confidence: float = 0.95

    @property
    def p1(self) -> Pt:
        return (self.x1, self.y1)

    @property
    def p2(self) -> Pt:
        return (self.x2, self.y2)

    @property
    def chord(self) -> float:
        return math.hypot(self.x2 - self.x1, self.y2 - self.y1)

    @property
    def direction(self) -> Pt:
        n = self.chord or 1.0
        return (self.x2 - self.x1) / n, (self.y2 - self.y1) / n

    @property
    def angle(self) -> float:
        return math.degrees(math.atan2(self.y2 - self.y1, self.x2 - self.x1)) % 180.0

    @property
    def curved(self) -> bool:
        return abs(self.bulge) > 1e-6

    def axis(self, step: float = 0.05) -> list[Pt]:
        if not self.curved:
            return [self.p1, self.p2]
        c, s = self.chord, self.bulge
        radius = (c * c / 4 + s * s) / (2 * abs(s))
        ux, uy = self.direction
        nx, ny = -uy, ux
        sign = 1.0 if s > 0 else -1.0
        d = radius - abs(s)
        mx, my = (self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2
        cx, cy = mx - sign * nx * d, my - sign * ny * d
        a0 = math.atan2(self.y1 - cy, self.x1 - cx)
        a1 = math.atan2(self.y2 - cy, self.x2 - cx)
        sweep = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        # elegir el sentido que pasa por la flecha
        mid_target = (mx + sign * nx * abs(s), my + sign * ny * abs(s))
        am = a0 + sweep / 2
        mid = (cx + radius * math.cos(am), cy + radius * math.sin(am))
        if math.dist(mid, mid_target) > abs(s):
            sweep = sweep - math.copysign(2 * math.pi, sweep)
        n = max(4, math.ceil(abs(sweep) * radius / step))
        return [
            (cx + radius * math.cos(a0 + sweep * i / n), cy + radius * math.sin(a0 + sweep * i / n))
            for i in range(n + 1)
        ]

    def footprint(self) -> Polygon:
        """Huella con los vanos CERRADOS; los rectos se extienden t/2 (esquinas cerradas)."""
        h = self.thickness / 2
        if self.curved:
            return LineString(self.axis()).buffer(h, cap_style="flat", join_style="mitre")
        ux, uy = self.direction
        a = (self.x1 - ux * h, self.y1 - uy * h)
        b = (self.x2 + ux * h, self.y2 + uy * h)
        return LineString([a, b]).buffer(h, cap_style="flat", join_style="mitre")


@dataclass
class StairCand:
    start: Pt
    end: Pt
    width: float
    steps: int


# ----------------------------------------------------------------------------- escaleras


def find_stairs(lines: Sequence[Line], tol: Tol = CAD) -> tuple[list[StairCand], set[int]]:
    """Haces de huellas: ≥ 5 líneas paralelas de igual largo, equiespaciadas 18 a 40 cm."""
    used: set[int] = set()
    stairs: list[StairCand] = []
    order = sorted(range(len(lines)), key=lambda i: (round(lines[i].angle), lines[i].length))
    for i in order:
        if i in used or lines[i].length < 0.6:
            continue
        a = lines[i]
        ua = a.direction
        na = (-ua[1], ua[0])
        group = [i]
        for j in order:
            if j == i or j in used:
                continue
            b = lines[j]
            if _angle_diff(a.angle, b.angle) > tol.angle:
                continue
            if abs(b.length - a.length) > 0.05 * a.length + tol.parallel:
                continue
            # mismos extremos proyectados sobre la dirección de la huella
            s1, s2 = sorted((_dot(_sub(b.p1, a.p1), ua), _dot(_sub(b.p2, a.p1), ua)))
            if abs(s1) > 0.05 or abs(s2 - a.length) > 0.05:
                continue
            group.append(j)
        if len(group) < 5:
            continue
        offs = sorted((_dot(_sub(lines[k].p1, a.p1), na), k) for k in group)
        best = _longest_even_run(offs)
        if len(best) < 5:
            continue
        used.update(best)
        first, last = lines[best[0]], lines[best[-1]]
        mid_first = ((first.x1 + first.x2) / 2, (first.y1 + first.y2) / 2)
        mid_last = ((last.x1 + last.x2) / 2, (last.y1 + last.y2) / 2)
        step = math.dist(mid_first, mid_last) / (len(best) - 1)
        dx, dy = _sub(mid_last, mid_first)
        n = math.hypot(dx, dy) or 1.0
        ux, uy = dx / n, dy / n
        used.update(_stringers(lines, first, last))
        if _closed_by_outline(lines, first, last):
            # la primera y la última línea son el contorno: n líneas = n - 1 huellas
            start, end, steps = mid_first, mid_last, len(best) - 1
        else:
            start = (mid_first[0] - ux * step, mid_first[1] - uy * step)
            end = (mid_last[0] + ux * step, mid_last[1] + uy * step)
            steps = len(best) + 1
        stairs.append(StairCand(start, end, a.length, steps))
    return stairs, used


def _longest_even_run(offs: list[tuple[float, int]]) -> list[int]:
    """La secuencia más larga de líneas consecutivas con paso constante de 18 a 40 cm."""
    best: list[int] = []
    i = 0
    while i < len(offs):
        run = [offs[i][1]]
        step: float | None = None
        k = i
        while k + 1 < len(offs):
            g = offs[k + 1][0] - offs[k][0]
            if 0.18 <= g <= 0.40 and (step is None or abs(g - step) < 0.03):
                step = step if step is not None else g
                run.append(offs[k + 1][1])
                k += 1
            else:
                break
        if len(run) > len(best):
            best = run
        i = k + 1 if k > i else i + 1
    return best


def _stringers(lines: Sequence[Line], first: Line, last: Line) -> set[int]:
    """Largueros: líneas que unen los extremos de la primera y la última huella (o los
    prolongan), del lado de cada extremo. No son muros aunque corran junto a uno."""
    out = set()
    u = first.direction
    span = _sub(((last.x1 + last.x2) / 2, (last.y1 + last.y2) / 2), first.p1)
    for i, ln in enumerate(lines):
        if _angle_diff(ln.angle, first.angle) < 60:
            continue  # los largueros son perpendiculares a las huellas
        for end in (first.p1, first.p2):
            # el larguero pasa por el extremo de la primera huella y llega hasta la última
            d1, t1 = _seg_dist(end, ln.p1, ln.p2)
            if d1 > 0.03 or not -0.05 <= t1 * ln.length <= ln.length + 0.05:
                continue
            reach = abs(_dot(span, (-u[1], u[0])))
            if ln.length >= 0.8 * reach:
                out.add(i)
    return out


def _closed_by_outline(lines: Sequence[Line], first: Line, last: Line) -> bool:
    """¿Hay líneas perpendiculares que unen los extremos de la primera y la última?"""
    for ends in (
        (first.p1, last.p1),
        (first.p1, last.p2),
        (first.p2, last.p1),
        (first.p2, last.p2),
    ):
        for ln in lines:
            if (math.dist(ln.p1, ends[0]) < 0.03 and math.dist(ln.p2, ends[1]) < 0.03) or (
                math.dist(ln.p2, ends[0]) < 0.03 and math.dist(ln.p1, ends[1]) < 0.03
            ):
                return True
    return False


# ----------------------------------------------------------------------------- muebles


def _parallel_near(
    ln: Line,
    lines: Sequence[Line],
    exclude: set[int],
    side: float | None = None,
    tol: Tol = CAD,
) -> list[int]:
    """Líneas paralelas a distancia de espesor de muro que se solapan con ``ln``.

    ``side`` (+1 / -1) limita a un lado de la normal izquierda de ``ln``.
    """
    u = ln.direction
    n = (-u[1], u[0])
    out = []
    for j, o in enumerate(lines):
        if j in exclude or o is ln or _angle_diff(ln.angle, o.angle) > tol.angle:
            continue
        d = _dot(_sub(o.p1, ln.p1), n)
        if not T_MIN <= abs(d) <= T_MAX or (side is not None and d * side <= 0):
            continue
        s1, s2 = sorted((_dot(_sub(o.p1, ln.p1), u), _dot(_sub(o.p2, ln.p1), u)))
        if min(ln.length, s2) - max(0.0, s1) >= 0.3 * min(ln.length, o.length):
            out.append(j)
    return out


def _has_partner(ln: Line, lines: Sequence[Line], exclude: set[int], tol: Tol = CAD) -> bool:
    """¿Tiene ``ln`` una cara gemela LIBRE? Por cada lado se mira solo la paralela más
    cercana: si esa ya tiene su gemela del otro lado (es la cara de un muro), ``ln`` no
    es la otra cara de ese muro sino algo dentro del ambiente."""
    u = ln.direction
    n = (-u[1], u[0])
    for side in (1.0, -1.0):
        near = _parallel_near(ln, lines, exclude, side=side, tol=tol)
        if not near:
            continue
        j = min(near, key=lambda k: abs(_dot(_sub(lines[k].p1, ln.p1), n)))
        o = lines[j]
        on = o.direction
        nn = (-on[1], on[0])
        # lado de ``o`` opuesto a ``ln``
        away = -1.0 if _dot((n[0] * side, n[1] * side), nn) < 0 else 1.0
        if not _parallel_near(o, lines, exclude | {j}, side=away, tol=tol):
            return True
    return False


def object_rectangles(lines: Sequence[Line], tol: Tol = CAD) -> set[int]:
    """Rectángulos de hasta 4 m dibujados con 4 líneas sueltas que NO son caras de muro.

    Un ambiente (cara interior de sus muros) tiene una cara gemela del otro lado de cada
    muro; una cama, un sofá o un mesón casi no: como mucho el lado que da contra la
    pared, o dos si está en una esquina. Con dos lados o menos acompañados, el
    rectángulo es un objeto y se aparta.
    """
    join = tol.join
    cell = 2 * join
    ends: dict[tuple[int, int], list[int]] = {}

    def key(p: Pt) -> tuple[int, int]:
        return (math.floor(p[0] / cell), math.floor(p[1] / cell))

    for i, ln in enumerate(lines):
        for p in (ln.p1, ln.p2):
            ends.setdefault(key(p), []).append(i)

    def near(p: Pt) -> list[tuple[float, int, Pt]]:
        """(distancia, línea, extremo opuesto) de las líneas con un extremo junto a ``p``."""
        kx, ky = key(p)
        out = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in ends.get((kx + dx, ky + dy), []):
                    ln = lines[j]
                    d1, d2 = math.dist(ln.p1, p), math.dist(ln.p2, p)
                    if min(d1, d2) <= cell:
                        out.append((min(d1, d2), j, ln.p2 if d1 <= d2 else ln.p1))
        return out

    found: set[int] = set()
    for i, a in enumerate(lines):
        if i in found or not 0.1 <= a.length <= 4.0:
            continue
        # recorrido: sigue de largo por tramos colineales (un lado partido por una línea
        # interior) y gira 90° en las esquinas; cierra tras 4 esquinas
        loop = [i]
        sides = [a.length]
        p = a.p2
        corners = 0
        ok = False
        for _ in range(16):
            cands = [c for c in near(p) if c[1] not in loop]
            last = lines[loop[-1]].angle
            straight = sorted(c for c in cands if _angle_diff(last, lines[c[1]].angle) <= 5)
            turn = sorted(c for c in cands if _angle_diff(last, lines[c[1]].angle) >= 80)
            if corners < 4 and math.dist(p, a.p1) <= cell and corners == 3:
                ok = True
                break
            if straight:
                nxt = straight[0]
                sides[-1] += lines[nxt[1]].length
            elif turn:
                nxt = turn[0]
                corners += 1
                sides.append(lines[nxt[1]].length)
            else:
                break
            loop.append(nxt[1])
            p = nxt[2]
        if not ok or len(sides) != 4:
            continue
        if max(sides) > 4.0 or min(sides) < 0.2:
            continue
        short, long_ = min(sides), max(sides)
        if short <= 0.4 and long_ >= 3 * short:
            continue  # angosto y largo: puede ser un muro suelto
        partners = sum(_has_partner(lines[k], lines, set(loop), tol) for k in loop)
        if partners <= max(2, len(loop) // 2):
            found.update(loop)
    return found


# ----------------------------------------------------------------------------- pares


def _uncovered(cov: list[tuple[float, float]], lo: float, hi: float) -> float:
    """Fracción de [lo, hi] que aún no está cubierta."""
    if hi <= lo:
        return 0.0
    covered = 0.0
    for a, b in cov:
        covered += max(0.0, min(hi, b) - max(lo, a))
    return max(0.0, 1.0 - covered / (hi - lo))


def pair_lines(
    lines: Sequence[Line], t_min: float = T_MIN, t_max: float = T_MAX, tol: Tol = CAD
) -> tuple[list[WallCand], set[int]]:
    """Empareja caras paralelas en tramos de muro (eje + espesor)."""
    bins: dict[int, list[int]] = {}
    for i, ln in enumerate(lines):
        if ln.length >= 0.02:
            bins.setdefault(round(ln.angle) % 180, []).append(i)
    cands: list[tuple[float, int, int, float, float, float]] = []
    for i, a in enumerate(lines):
        if a.length < 0.02:
            continue
        ua = a.direction
        na = (-ua[1], ua[0])
        key = round(a.angle) % 180
        span = math.ceil(tol.angle)
        near = {j for k in range(key - span, key + span + 1) for j in bins.get(k % 180, [])}
        for j in near:
            if j <= i:
                continue
            b = lines[j]
            if _angle_diff(a.angle, b.angle) > tol.angle:
                continue
            d1 = _dot(_sub(b.p1, a.p1), na)
            d2 = _dot(_sub(b.p2, a.p1), na)
            if abs(d1 - d2) > tol.parallel:
                continue
            d = (d1 + d2) / 2
            if not t_min <= abs(d) <= t_max:
                continue
            s1 = _dot(_sub(b.p1, a.p1), ua)
            s2 = _dot(_sub(b.p2, a.p1), ua)
            lo, hi = max(0.0, min(s1, s2)), min(a.length, max(s1, s2))
            if hi - lo < max(0.1, 0.8 * abs(d)):
                continue
            cands.append((abs(d), i, j, lo, hi, d))
    cands.sort()
    cov: dict[int, list[tuple[float, float]]] = {}
    used: set[int] = set()
    pieces: list[WallCand] = []
    for _, i, j, lo, hi, d in cands:
        a, b = lines[i], lines[j]
        ua = a.direction
        na = (-ua[1], ua[0])
        ub = b.direction
        pa_lo = (a.x1 + ua[0] * lo, a.y1 + ua[1] * lo)
        pa_hi = (a.x1 + ua[0] * hi, a.y1 + ua[1] * hi)
        jb = sorted((_dot(_sub(pa_lo, b.p1), ub), _dot(_sub(pa_hi, b.p1), ub)))
        if _uncovered(cov.get(i, []), lo, hi) < 0.5:
            continue
        if _uncovered(cov.get(j, []), jb[0], jb[1]) < 0.5:
            continue
        cov.setdefault(i, []).append((lo, hi))
        cov.setdefault(j, []).append((jb[0], jb[1]))
        used.update((i, j))
        h = d / 2
        pieces.append(
            WallCand(
                pa_lo[0] + na[0] * h,
                pa_lo[1] + na[1] * h,
                pa_hi[0] + na[0] * h,
                pa_hi[1] + na[1] * h,
                abs(d),
            )
        )
    return pieces, used


def _interval_overlap(a: tuple[float, float], b: tuple[float, float]) -> tuple[float, float]:
    best = (0.0, 0.0)
    for shift in (-2 * math.pi, 0.0, 2 * math.pi):
        lo = max(a[0], b[0] + shift)
        hi = min(a[1], b[1] + shift)
        if hi - lo > best[1] - best[0]:
            best = (lo, hi)
    return best


def pair_arcs(
    arcs: Sequence[ArcPrim], t_min: float = T_MIN, t_max: float = T_MAX, tol: Tol = CAD
) -> tuple[list[WallCand], set[int]]:
    """Dos arcos concéntricos a distancia de espesor → muro curvo (eje = radio medio)."""
    used: set[int] = set()
    walls: list[WallCand] = []
    cands = []
    for i, a in enumerate(arcs):
        for j in range(i + 1, len(arcs)):
            b = arcs[j]
            if math.dist((a.cx, a.cy), (b.cx, b.cy)) > tol.concentric + 0.01 * max(a.r, b.r):
                continue
            dr = abs(a.r - b.r)
            if not t_min <= dr <= t_max:
                continue
            lo, hi = _interval_overlap(a.interval(), b.interval())
            if (hi - lo) * min(a.r, b.r) < 0.3:
                continue
            cands.append((dr, i, j, lo, hi))
    cands.sort()
    for dr, i, j, lo, hi in cands:
        if i in used or j in used:
            continue
        used.update((i, j))
        a, b = arcs[i], arcs[j]
        cx, cy = (a.cx + b.cx) / 2, (a.cy + b.cy) / 2
        rm = (a.r + b.r) / 2
        p1 = (cx + rm * math.cos(lo), cy + rm * math.sin(lo))
        p2 = (cx + rm * math.cos(hi), cy + rm * math.sin(hi))
        mid = ((lo + hi) / 2,)
        pm = (cx + rm * math.cos(mid[0]), cy + rm * math.sin(mid[0]))
        q = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)
        ux, uy = (p2[0] - p1[0]), (p2[1] - p1[1])
        n = math.hypot(ux, uy) or 1.0
        left = (-uy / n, ux / n)
        bulge = _dot(_sub(pm, q), left)
        walls.append(WallCand(p1[0], p1[1], p2[0], p2[1], dr, bulge=bulge))
    return walls, used


# ----------------------------------------------------------------------------- regularización


def dominant_angles(pieces: Sequence[WallCand], min_share: float = 0.08) -> list[float]:
    """Direcciones principales del edificio: picos del histograma de ángulos (1°)
    ponderado por largo, con al menos ``min_share`` del largo total."""
    hist = np.zeros(180)
    for p in pieces:
        if not p.curved:
            hist[round(p.angle) % 180] += p.chord
    if hist.sum() <= 0:
        return []
    smooth = hist + np.roll(hist, 1) + np.roll(hist, -1)
    peaks: list[float] = []
    for k in np.argsort(-smooth):
        if smooth[k] < min_share * hist.sum():
            break
        if all(_angle_diff(float(k), q) > 5 for q in peaks):
            # promedio ponderado alrededor del pico
            ks = [(k + d) % 180 for d in (-2, -1, 0, 1, 2)]
            ws = [hist[i] for i in ks]
            if sum(ws) > 0:
                ang = sum(((k + d) * w) for d, w in zip((-2, -1, 0, 1, 2), ws, strict=True))
                peaks.append((ang / sum(ws)) % 180)
    return peaks


def regularize(pieces: list[WallCand], tol_deg: float) -> list[WallCand]:
    """Gira cada tramo recto, sobre su punto medio, a la dirección dominante cercana."""
    peaks = dominant_angles(pieces)
    out = []
    for p in pieces:
        if p.curved or not peaks:
            out.append(p)
            continue
        best = min(peaks, key=lambda q: _angle_diff(p.angle, q))
        if _angle_diff(p.angle, best) > tol_deg:
            out.append(p)
            continue
        mx, my = (p.x1 + p.x2) / 2, (p.y1 + p.y2) / 2
        a = math.radians(best)
        ux, uy = math.cos(a), math.sin(a)
        if ux * (p.x2 - p.x1) + uy * (p.y2 - p.y1) < 0:
            ux, uy = -ux, -uy
        h = p.chord / 2
        out.append(
            WallCand(
                mx - ux * h,
                my - uy * h,
                mx + ux * h,
                my + uy * h,
                p.thickness,
                0.0,
                p.openings,
                p.confidence,
            )
        )
    return out


# ----------------------------------------------------------------------------- cadenas


@dataclass
class _Evidence:
    lines: Sequence[Line]
    arcs: Sequence[ArcPrim]
    inserts: Sequence[Insert]


def _classify_gap(
    origin: Pt,
    u: Pt,
    offset_c: float,
    t: float,
    g0: float,
    g1: float,
    windows: list[tuple[float, float]],
    ev: _Evidence,
) -> OpeningCand:
    """Abertura en [g0, g1] (parámetros sobre la recta) con la evidencia disponible."""
    n = (-u[1], u[0])
    width = g1 - g0

    def to_line(p: Pt) -> tuple[float, float]:
        rel = _sub(p, origin)
        return _dot(rel, u), _dot(rel, n) - offset_c

    # 1) bloque insertado dentro del vano
    for ins in ev.inserts:
        s, off = to_line((ins.x, ins.y))
        if g0 - 0.25 <= s <= g1 + 0.25 and abs(off) <= t + 0.3:
            kind = block_kind(ins.name)
            if kind:
                return OpeningCand(g0, width, kind, 0.95)
    # 2) ventana: tramo delgado o líneas finas a lo largo de la banda del muro
    for w0, w1 in windows:
        if min(g1, w1) - max(g0, w0) >= 0.5 * width:
            return OpeningCand(g0, width, "window", 0.9)
    count = 0
    for ln in ev.lines:
        if _angle_diff(ln.angle, math.degrees(math.atan2(u[1], u[0])) % 180) > 3:
            continue
        s1, o1 = to_line(ln.p1)
        s2, o2 = to_line(ln.p2)
        if max(abs(o1), abs(o2)) > t / 2 + 0.03:
            continue
        if min(g1, max(s1, s2)) - max(g0, min(s1, s2)) >= 0.5 * width:
            count += 1
    if count >= 2:
        return OpeningCand(g0, width, "window", 0.9)
    # 3) puerta: arco de giro con centro en una jamba
    for arc in ev.arcs:
        s, off = to_line((arc.cx, arc.cy))
        if abs(off) > t / 2 + 0.1 or not 0.6 * width <= arc.r <= 1.35 * width:
            continue
        hinge_tol = max(0.15, 0.25 * width)  # en fotos el arco detectado suele ser parcial
        at_start = abs(s - g0) <= hinge_tol
        at_end = abs(s - g1) <= hinge_tol
        if not (at_start or at_end):
            continue
        pm = arc.point(0.5)
        side = _dot(_sub(pm, (arc.cx, arc.cy)), n)
        return OpeningCand(
            g0,
            width,
            "door",
            0.95,
            operation="swing",
            hinge_at_end=abs(s - g1) < abs(s - g0),
            opens_left=side > 0,
        )
    return OpeningCand(g0, width, "door", 0.5)


_Item = tuple[float, float, float, float, "WallCand"]


def _touches_cross(p: Pt, pieces: Sequence[WallCand], ref: WallCand, t: float) -> bool:
    """¿El punto ``p`` (borde de un hueco) está sobre un muro transversal?"""
    for o in pieces:
        if _angle_diff(o.angle, ref.angle) < 20:
            continue
        dist, tt = _seg_dist(p, o.p1, o.p2)
        ext = (t + o.thickness) / (o.chord or 1.0)
        if dist <= o.thickness / 2 + t + 0.05 and -ext <= tt <= 1 + ext:
            return True
    return False


def _emit(chain: list[_Item], openings: list[OpeningCand], u: Pt, n: Pt) -> WallCand:
    """Un muro desde una cadena de tramos colineales (s0, s1, espesor, offset, tramo)."""
    s0 = chain[0][0]
    s1 = max(c[1] for c in chain)
    total = sum(c[1] - c[0] for c in chain) or 1.0
    t = sum((c[1] - c[0]) * c[2] for c in chain) / total
    c_off = sum((c[1] - c[0]) * c[3] for c in chain) / total
    a = (u[0] * s0 + n[0] * c_off, u[1] * s0 + n[1] * c_off)
    b = (u[0] * s1 + n[0] * c_off, u[1] * s1 + n[1] * c_off)
    ops = [
        OpeningCand(
            o.offset - s0, o.width, o.kind, o.confidence, o.operation, o.hinge_at_end, o.opens_left
        )
        for o in openings
    ]
    return WallCand(a[0], a[1], b[0], b[1], t, openings=ops)


def _add_inside_windows(w: WallCand, inside: list[tuple[float, float]], u: Pt) -> None:
    """Ventanas cuya línea central quedó dentro de un muro continuo (ver ``chain_walls``)."""
    s0 = _dot(w.p1, u)
    sign = 1.0 if _dot(w.direction, u) > 0 else -1.0
    for a, b in inside:
        lo, hi = sorted(((a - s0) * sign, (b - s0) * sign))
        if lo < -0.01 or hi > w.chord + 0.01:
            continue
        if any(lo < o.offset + o.width and o.offset < hi for o in w.openings):
            continue
        w.openings.append(OpeningCand(max(0.0, lo), hi - lo, "window", 0.8))
    w.openings.sort(key=lambda o: o.offset)


def chain_walls(
    pieces: Sequence[WallCand], evidence: _Evidence | None = None, tol: Tol = CAD
) -> list[WallCand]:
    """Une tramos colineales; los huecos de 45 cm a 3 m se vuelven aberturas."""
    ev = evidence or _Evidence((), (), ())
    if tol.regularize > 0:
        pieces = regularize(list(pieces), tol.regularize)
    straight = [p for p in pieces if not p.curved]
    groups: list[list[WallCand]] = []
    for p in sorted(straight, key=lambda p: p.angle):
        for g in groups:
            ref = g[0]
            if _angle_diff(ref.angle, p.angle) > max(1.5, tol.angle):
                continue
            u = ref.direction
            n = (-u[1], u[0])
            c_ref = _dot(ref.p1, n)
            mid = ((p.x1 + p.x2) / 2, (p.y1 + p.y2) / 2)
            if abs(_dot(mid, n) - c_ref) <= 0.5 * max(ref.thickness, p.thickness):
                g.append(p)
                break
        else:
            groups.append([p])

    out: list[WallCand] = []
    for g in groups:
        ref = g[0]
        u = ref.direction
        n = (-u[1], u[0])
        origin = (0.0, 0.0)
        items: list[_Item] = []
        for p in g:
            s1, s2 = _dot(p.p1, u), _dot(p.p2, u)
            items.append((min(s1, s2), max(s1, s2), p.thickness, _dot(p.p1, n), p))
        items.sort(key=lambda it: it[0])
        tmax = max(it[2] for it in items)
        # tramos "delgados" entre dos gruesos: relleno de ventana
        thick = [it for it in items if it[2] >= 0.7 * tmax]
        windows: list[tuple[float, float]] = []
        inside: list[tuple[float, float]] = []  # ventanas dentro de un muro continuo
        for it in items:
            if it[2] >= 0.7 * tmax:
                continue
            if any(t[0] <= it[0] + 0.02 and t[1] >= it[1] - 0.02 for t in thick):
                # en una foto, las líneas exteriores de la ventana se funden con las caras
                # del muro: solo queda la central, DENTRO de la banda del muro
                if MIN_OPENING <= it[1] - it[0] <= MAX_OPENING:
                    inside.append((it[0], it[1]))
                continue
            before = any(t[1] <= it[0] + 0.05 for t in thick)
            after = any(t[0] >= it[1] - 0.05 for t in thick)
            if before and after:
                windows.append((it[0], it[1]))
            else:
                thick.append(it)
        thick.sort(key=lambda it: it[0])
        first_new = len(out)

        chain: list[_Item] = []
        openings: list[OpeningCand] = []
        for it in thick:
            if chain:
                end = max(c[1] for c in chain)
                t_here = max(chain[-1][2], it[2])
                gap = it[0] - end
                similar = abs(chain[-1][2] - it[2]) <= 0.35 * t_here
                junction = 1.6 * t_here + 0.02
                if gap <= junction and (similar or gap <= 0):
                    chain.append(it)
                    continue
                if similar and max(junction, MIN_OPENING) <= gap <= MAX_OPENING:
                    c_off = chain[-1][3]
                    op = _classify_gap(origin, u, c_off, t_here, end, it[0], windows, ev)
                    p_end = (u[0] * end + n[0] * c_off, u[1] * end + n[1] * c_off)
                    p_next = (u[0] * it[0] + n[0] * c_off, u[1] * it[0] + n[1] * c_off)
                    crossed = _touches_cross(p_end, straight, ref, t_here) or _touches_cross(
                        p_next, straight, ref, t_here
                    )
                    # sin evidencia y con muros transversales en los bordes: son dos muros
                    # distintos (p. ej. tabiques alineados a lado y lado de un corredor)
                    if not (op.confidence <= 0.5 and crossed):
                        openings.append(op)
                        chain.append(it)
                        continue
                out.append(_emit(chain, openings, u, n))
                chain, openings = [], []
            chain.append(it)
        if chain:
            out.append(_emit(chain, openings, u, n))
        for w in out[first_new:]:
            _add_inside_windows(w, inside, u)
    return out + [p for p in pieces if p.curved]


# ----------------------------------------------------------------------------- topología


def _seg_dist(p: Pt, a: Pt, b: Pt) -> tuple[float, float]:
    """(distancia, parámetro t sin acotar) del punto p a la recta a-b."""
    ab = _sub(b, a)
    l2 = _dot(ab, ab) or 1e-12
    t = _dot(_sub(p, a), ab) / l2
    q = (a[0] + ab[0] * t, a[1] + ab[1] * t)
    return math.dist(p, q), t


def _intersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt) -> Pt | None:
    x1, y1 = a1
    x2, y2 = a2
    x3, y3 = b1
    x4, y4 = b2
    den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(den) < 1e-12:
        return None
    a = x1 * y2 - y1 * x2
    b = x3 * y4 - y3 * x4
    return ((a * (x3 - x4) - (x1 - x2) * b) / den, (a * (y3 - y4) - (y1 - y2) * b) / den)


def _circle(w: WallCand) -> tuple[float, float, float, float, float]:
    """(cx, cy, r, ángulo inicial, barrido con signo) del eje de un muro curvo."""
    pts = w.axis(0.02)
    c, sg = w.chord, w.bulge
    r = (c * c / 4 + sg * sg) / (2 * abs(sg))
    ux, uy = w.direction
    nx, ny = -uy, ux
    sign = 1.0 if sg > 0 else -1.0
    d = r - abs(sg)
    mx, my = (w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2
    cx, cy = mx - sign * nx * d, my - sign * ny * d
    a0 = math.atan2(pts[0][1] - cy, pts[0][0] - cx)
    a_mid = math.atan2(pts[len(pts) // 2][1] - cy, pts[len(pts) // 2][0] - cx)
    a1 = math.atan2(pts[-1][1] - cy, pts[-1][0] - cx)
    sweep = (a1 - a0) % (2 * math.pi)
    if (a_mid - a0) % (2 * math.pi) > sweep:
        sweep -= 2 * math.pi
    return cx, cy, r, a0, sweep


def extend_curved(w: WallCand, walls: Sequence[WallCand], max_deg: float = 70.0) -> None:
    """Un arco detectado en una foto suele quedar corto: se prolonga por su circunferencia
    hasta tocar el eje de un muro recto (si lo encuentra a menos de ``max_deg``)."""
    cx, cy, r, a0, sweep = _circle(w)
    straight = [o for o in walls if not o.curved]
    if not straight:
        return

    def touching(p: Pt) -> bool:
        for o in straight:
            dist, t = _seg_dist(p, o.p1, o.p2)
            if dist <= o.thickness / 2 + w.thickness / 2 and -0.05 <= t <= 1.05:
                return True
        return False

    direction = 1.0 if sweep > 0 else -1.0
    new_a0, new_a1 = a0, a0 + sweep
    for end in (0, 1):
        base = new_a0 if end == 0 else new_a1
        p_end = (cx + r * math.cos(base), cy + r * math.sin(base))
        if touching(p_end):
            continue
        step = -direction if end == 0 else direction
        for k in range(1, int(max_deg) + 1):
            a = base + step * math.radians(k)
            p = (cx + r * math.cos(a), cy + r * math.sin(a))
            if touching(p):
                if end == 0:
                    new_a0 = a
                else:
                    new_a1 = a
                break
    if (new_a0, new_a1) == (a0, a0 + sweep):
        return
    p1 = (cx + r * math.cos(new_a0), cy + r * math.sin(new_a0))
    p2 = (cx + r * math.cos(new_a1), cy + r * math.sin(new_a1))
    am = (new_a0 + new_a1) / 2
    pm = (cx + r * math.cos(am), cy + r * math.sin(am))
    q = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)
    ch = math.dist(p1, p2) or 1.0
    left = (-(p2[1] - p1[1]) / ch, (p2[0] - p1[0]) / ch)
    bulge = _dot(_sub(pm, q), left)
    if abs(bulge) > ch / 2:  # más de media circunferencia: no se representa
        return
    w.x1, w.y1 = p1
    w.x2, w.y2 = p2
    w.bulge = bulge


def _arc_through(p1: Pt, pm: Pt, p2: Pt) -> float | None:
    """Flecha (con signo, convención de ``WallCand``) del arco que pasa por 3 puntos."""
    ax, ay = p1
    bx, by = pm
    cx, cy = p2
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-12:
        return None
    ux = (
        (ax**2 + ay**2) * (by - cy) + (bx**2 + by**2) * (cy - ay) + (cx**2 + cy**2) * (ay - by)
    ) / d
    uy = (
        (ax**2 + ay**2) * (cx - bx) + (bx**2 + by**2) * (ax - cx) + (cx**2 + cy**2) * (bx - ax)
    ) / d
    r = math.dist((ux, uy), p1)
    q = ((ax + cx) / 2, (ay + cy) / 2)
    ch = math.dist(p1, p2) or 1.0
    left = (-(cy - ay) / ch, (cx - ax) / ch)
    # el punto medio del arco, del lado donde está ``pm``
    side = 1.0 if _dot(_sub(pm, q), left) > 0 else -1.0
    sag = r - math.sqrt(max(0.0, r * r - ch * ch / 4))
    if math.dist((ux, uy), pm) > 0 and _dot(_sub((ux, uy), q), left) * side > 0:
        sag = 2 * r - sag  # más de media circunferencia
    return side * sag


def attach_curved(w: WallCand, walls: Sequence[WallCand], reach: float = 0.8) -> None:
    """Lleva cada extremo de un muro curvo al extremo libre más cercano de un muro recto
    (a menos de ``reach`` m) y rehace el arco por esos extremos y su punto medio."""
    pts = w.axis(0.02)
    pm = pts[len(pts) // 2]
    ends = [p for o in walls if not o.curved for p in (o.p1, o.p2)]
    if not ends:
        return
    new = []
    for p in (w.p1, w.p2):
        q = min(ends, key=lambda e: math.dist(e, p))
        new.append(q if math.dist(q, p) <= reach else p)
    if new[0] == w.p1 and new[1] == w.p2:
        return
    if math.dist(new[0], new[1]) < 0.3:
        return
    bulge = _arc_through(new[0], pm, new[1])
    if bulge is None or abs(bulge) > math.dist(new[0], new[1]) / 2:
        return
    (w.x1, w.y1), (w.x2, w.y2) = new
    w.bulge = bulge


def snap(walls: list[WallCand], factor: float = 1.25) -> list[WallCand]:
    """Lleva cada extremo a la intersección con el eje del muro que toca (L y T)."""
    for w in walls:
        if w.curved:
            extend_curved(w, walls)
            attach_curved(w, walls, reach=0.8 if factor > 1.5 else 0.0)
    for w in walls:
        for end in (0, 1):
            p = w.p1 if end == 0 else w.p2
            best: tuple[float, Pt] | None = None
            for o in walls:
                if o is w:
                    continue
                if o.curved:
                    # un muro recto que llega a un muro curvo: se prolonga sobre su propia
                    # recta hasta el extremo del arco (bow windows, esquinas redondeadas)
                    if w.curved:
                        continue
                    tol_c = factor * max(w.thickness, o.thickness)
                    for e in (o.p1, o.p2):
                        if math.dist(p, e) <= tol_c:
                            ux, uy = w.direction
                            along = _dot(_sub(e, p), (ux, uy))
                            q = (p[0] + ux * along, p[1] + uy * along)
                            dist = math.dist(p, e)
                            if best is None or dist < best[0]:
                                best = (dist, q)
                    continue
                if not w.curved and _angle_diff(w.angle, o.angle) < 20:
                    continue
                tol = factor * max(w.thickness, o.thickness)
                dist, t = _seg_dist(p, o.p1, o.p2)
                ext = tol / (o.chord or 1.0)
                if dist > tol or t < -ext or t > 1 + ext:
                    continue
                if w.curved:
                    q = (o.x1 + (o.x2 - o.x1) * t, o.y1 + (o.y2 - o.y1) * t)
                else:
                    q_ = _intersect(w.p1, w.p2, o.p1, o.p2)
                    if q_ is None:
                        continue
                    q = q_
                if best is None or dist < best[0]:
                    best = (dist, q)
            if best is None:
                continue
            q = best[1]
            if end == 0:
                if not w.curved:
                    shift = _dot(_sub(q, w.p1), w.direction)
                    for op in w.openings:
                        op.offset -= shift
                w.x1, w.y1 = q
            else:
                w.x2, w.y2 = q
    kept = []
    for w in walls:
        length = w.chord
        w.openings = [
            o for o in w.openings if o.offset >= -1e-6 and o.offset + o.width <= length + 1e-6
        ]
        if length >= max(0.05, 0.5 * w.thickness) or w.openings:
            kept.append(w)
    return kept


def connected_only(walls: list[WallCand], keep_ratio: float = 0.15) -> list[WallCand]:
    """Descarta grupos de "muros" sueltos (muebles, mesones) lejos del edificio."""
    n = len(walls)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    lines = [LineString(w.axis()) for w in walls]
    for i in range(n):
        for j in range(i + 1, n):
            tol = max(walls[i].thickness, walls[j].thickness) + 0.05
            if lines[i].distance(lines[j]) <= tol:
                parent[find(i)] = find(j)
    total: dict[int, float] = {}
    for i in range(n):
        total[find(i)] = total.get(find(i), 0.0) + lines[i].length
    if not total:
        return []
    biggest = max(total.values())
    return [w for i, w in enumerate(walls) if total[find(i)] >= keep_ratio * biggest]


# ----------------------------------------------------------------------------- ambientes


def rooms_from_walls(walls: Iterable[WallCand], min_area: float = 1.0) -> list[Polygon]:
    """Cada agujero de la unión de huellas (vanos cerrados) es un ambiente."""
    union = unary_union([w.footprint() for w in walls])
    polys = list(getattr(union, "geoms", [union]))
    rooms: list[Polygon] = []
    for poly in polys:
        if poly.is_empty or poly.geom_type != "Polygon":
            continue
        for ring in poly.interiors:
            room = Polygon(ring).simplify(0.002)
            if room.is_valid and room.area >= min_area:
                rooms.append(room)
    return rooms


def exterior_walls(walls: Sequence[WallCand]) -> set[int]:
    """Índices de muros que tocan el contorno exterior del edificio."""
    union = unary_union([w.footprint() for w in walls])
    polys = list(getattr(union, "geoms", [union]))
    rings = [LineString(p.exterior.coords) for p in polys if p.geom_type == "Polygon"]
    out = set()
    for i, w in enumerate(walls):
        mid = LineString(w.axis()).interpolate(0.5, normalized=True)
        if any(r.distance(mid) <= 0.75 * w.thickness + 1e-6 for r in rings):
            out.add(i)
    return out


# ----------------------------------------------------------------------------- columnas


@dataclass
class ColumnCand:
    center: Pt
    width: float
    depth: float
    round: bool
    rotation: float


def columns_from_closed(closed: Iterable[Closed], column_layer: bool = False) -> list[ColumnCand]:
    out = []
    for c in closed:
        if not (c.filled or column_layer) or len(c.points) < 3:
            continue
        poly = Polygon(c.points)
        if not poly.is_valid or not 0.01 <= poly.area <= 1.5:
            continue
        rect = poly.minimum_rotated_rectangle
        xs, ys = rect.exterior.coords.xy
        e1 = math.dist((xs[0], ys[0]), (xs[1], ys[1]))
        e2 = math.dist((xs[1], ys[1]), (xs[2], ys[2]))
        if max(e1, e2) > 3 * min(e1, e2):
            continue
        roundness = 4 * math.pi * poly.area / (poly.length**2)
        is_round = len(c.points) > 8 and roundness > 0.85
        rot = math.atan2(ys[1] - ys[0], xs[1] - xs[0])
        ctr = poly.centroid
        if is_round:
            d = 2 * math.sqrt(poly.area / math.pi)
            out.append(ColumnCand((ctr.x, ctr.y), d, d, True, 0.0))
        else:
            out.append(ColumnCand((ctr.x, ctr.y), e1, e2, False, rot % (math.pi / 2)))
    return out


def plausible_columns(cands: list[ColumnCand], walls: Sequence[WallCand]) -> list[ColumnCand]:
    """Descarta manchas que en una imagen se confunden con columnas.

    Una columna toca un muro o, si es exenta (porche, galería), está dentro del edificio y
    lejos de otras. Las marcas de cota, puntas de flecha y achurados dan filas de manchas
    iguales y muy juntas, casi siempre fuera del contorno. Sin escala: todo se mide en
    tamaños de la propia columna.
    """
    if not cands or not walls:
        return cands
    lines = [(LineString([w.p1, w.p2]), w.thickness) for w in walls]
    hull = MultiPoint([p for w in walls for p in (w.p1, w.p2)]).convex_hull

    def keep(c: ColumnCand) -> bool:
        size = max(c.width, c.depth)
        p = Point(c.center)
        if min(ln.distance(p) - t / 2 for ln, t in lines) <= size * 0.75:
            return True
        lonely = all(math.dist(c.center, o.center) >= 3 * size for o in cands if o is not c)
        return lonely and bool(hull.contains(p))

    return [c for c in cands if keep(c)]


def point_in(poly: Polygon, x: float, y: float) -> bool:
    return bool(poly.contains(Point(x, y)))

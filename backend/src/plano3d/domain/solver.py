"""Solver de cotas (ADR-015): ajusta la geometría a las medidas ESCRITAS en el plano.

Formulación (mínimos cuadrados ponderados, lineal):
- Variables: las coordenadas (x, y) de los nodos del grafo de muros (extremos unidos).
- Restricciones fuertes (peso alto):
  * cada muro conserva su ORIENTACIÓN observada: cruz(pⱼ - pᵢ, d₀) = 0;
  * cada encuentro en T queda SOBRE el eje del muro anfitrión: cruz(d_host, p - a) = 0.
- Restricciones blandas:
  * cada COTA: (p_b - p_a) · u = valor, enlazada al eje o a la cara del muro más cercano
    (en Colombia se acota a ejes o a caras: se elige lo que mejor coincide);
  * cada nodo se queda cerca de donde se observó (sigma = incertidumbre de la medición), para
    que el problema esté bien planteado donde no hay cotas.
Fijar la orientación observada vuelve lineal el problema: se resuelve con NumPy por
mínimos cuadrados, con re-ponderación robusta de Cauchy (IRLS) para que una cota mal
leída no arrastre a las demás. Las ataduras reparten el ajuste: el edificio no "se
corre" hacia un lado, conserva su centro. Después, cada cota queda EXACTA (residuo
< 1 cm) o en CONFLICTO, y cada muro cuyo largo quedó fijado por cotas pasa a EXACTO.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace

import numpy as np

from plano3d.domain.building import EPS, Level, Opening, Room, Wall
from plano3d.domain.elements import (
    Dimension,
    DimensionAxis,
    Measure,
    MeasureSource,
    MeasureStatus,
)
from plano3d.domain.errors import DomainError
from plano3d.domain.geometry import Point2D

EXACT_TOL = 0.01  # m: una cota se cumple si el residuo queda por debajo
ROBUST = 0.02  # m: escala de Cauchy; una cota con residuo mucho mayor casi no pesa
W_HARD = 1e5  # peso de orientación y encuentros en T
NODE_TOL = 0.02  # m: extremos más cerca que esto son el mismo nodo


@dataclass
class SolveReport:
    dims_exact: int = 0
    dims_conflict: int = 0
    dims_unlinked: int = 0
    walls_exact: int = 0
    max_residual: float = 0.0
    moved_max: float = 0.0
    conflicts: list[str] = field(default_factory=list)


@dataclass
class _Link:
    """Extremo de una cota enlazado a un nodo (+ desplazamiento a cara)."""

    node: int
    offset: tuple[float, float]


class _System:
    def __init__(self, n_nodes: int) -> None:
        self.n = n_nodes
        self.rows: list[np.ndarray] = []
        self.rhs: list[float] = []
        self.weights: list[float] = []
        self.kinds: list[str] = []
        self.tags: list[int] = []

    def add(self, coefs: dict[int, float], rhs: float, w: float, kind: str, tag: int = -1) -> None:
        row = np.zeros(2 * self.n)
        for k, v in coefs.items():
            row[k] += v
        self.rows.append(row)
        self.rhs.append(rhs)
        self.weights.append(w)
        self.kinds.append(kind)
        self.tags.append(tag)


def _nodes(walls: tuple[Wall, ...]) -> tuple[list[Point2D], list[tuple[int, int]]]:
    pts: list[Point2D] = []
    ends: list[tuple[int, int]] = []

    def node(p: Point2D) -> int:
        for k, q in enumerate(pts):
            if q.distance_to(p) <= NODE_TOL:
                return k
        pts.append(p)
        return len(pts) - 1

    for w in walls:
        ends.append((node(w.start), node(w.end)))
    return pts, ends


def _seg_param(p: Point2D, a: Point2D, b: Point2D) -> tuple[float, float]:
    """(distancia a la recta, parámetro t a lo largo del segmento)."""
    dx, dy = b.x - a.x, b.y - a.y
    l2 = dx * dx + dy * dy or 1e-12
    t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2
    qx, qy = a.x + dx * t, a.y + dy * t
    return math.hypot(p.x - qx, p.y - qy), t


def _link(
    p: Point2D,
    axis: DimensionAxis,
    nodes: list[Point2D],
    walls: tuple[Wall, ...],
    ends: list[tuple[int, int]],
    tol: float,
) -> _Link | None:
    """El punto de referencia de un extremo de cota: un nodo (eje) o la cara de su muro."""
    best: tuple[float, _Link] | None = None
    for wi, w in enumerate(walls):
        i, j = ends[wi]
        dx, dy = w.end.x - w.start.x, w.end.y - w.start.y
        length = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / length, dx / length
        h = w.thickness / 2
        for node in (i, j):
            q = nodes[node]
            for off in ((0.0, 0.0), (nx * h, ny * h), (-nx * h, -ny * h)):
                rx, ry = q.x + off[0], q.y + off[1]
                if axis is DimensionAxis.HORIZONTAL:
                    d = abs(rx - p.x)
                elif axis is DimensionAxis.VERTICAL:
                    d = abs(ry - p.y)
                else:
                    d = math.hypot(rx - p.x, ry - p.y)
                # preferir el eje frente a la cara si están igual de cerca
                score = d + (0.001 if off != (0.0, 0.0) else 0.0)
                if d <= tol and (best is None or score < best[0]):
                    best = (score, _Link(node, off))
    return best[1] if best else None


def solve_level(
    level: Level, sigma: float = 0.05, link_tol: float = 0.15
) -> tuple[Level, SolveReport]:
    """Ajusta los muros del nivel a sus cotas. Devuelve el nivel nuevo y un reporte."""
    report = SolveReport()
    walls = level.walls
    if not walls or not level.dimensions:
        return level, report
    nodes, ends = _nodes(walls)
    n = len(nodes)
    sys = _System(n)

    def X(k: int) -> int:  # noqa: N802 - índice de la x del nodo k
        return 2 * k

    def Y(k: int) -> int:  # noqa: N802
        return 2 * k + 1

    # atadura débil a lo observado
    for k, p in enumerate(nodes):
        sys.add({X(k): 1.0}, p.x, 1.0 / sigma, "prior")
        sys.add({Y(k): 1.0}, p.y, 1.0 / sigma, "prior")
    # orientación de cada muro
    for wi, w in enumerate(walls):
        i, j = ends[wi]
        dx, dy = w.end.x - w.start.x, w.end.y - w.start.y
        length = math.hypot(dx, dy)
        if length < EPS or i == j:
            continue
        ux, uy = dx / length, dy / length
        # cruz((pj - pi), u) = (xj - xi) uy - (yj - yi) ux = 0
        sys.add({X(j): uy, X(i): -uy, Y(j): -ux, Y(i): ux}, 0.0, W_HARD, "dir")
    # encuentros en T: un nodo sobre el tramo interior de otro muro
    tees: list[tuple[int, int]] = []
    for k, p in enumerate(nodes):
        for wi, w in enumerate(walls):
            i, j = ends[wi]
            if k in (i, j):
                continue
            dist, t = _seg_param(p, w.start, w.end)
            if dist <= w.thickness / 2 + NODE_TOL and 0.02 < t < 0.98:
                dx, dy = w.end.x - w.start.x, w.end.y - w.start.y
                length = math.hypot(dx, dy) or 1.0
                ux, uy = dx / length, dy / length
                # cruz(u, p - a) con a = nodo i: (px - xi) uy - (py - yi) ux = 0
                sys.add({X(k): uy, X(i): -uy, Y(k): -ux, Y(i): ux}, 0.0, W_HARD, "tee")
                tees.append((k, wi))
    # cotas
    links: dict[int, tuple[_Link, _Link, tuple[float, float]]] = {}
    for di, d in enumerate(level.dimensions):
        la = _link(d.a, d.axis, nodes, walls, ends, link_tol)
        lb = _link(d.b, d.axis, nodes, walls, ends, link_tol)
        if la is None or lb is None or (la.node == lb.node and la.offset == lb.offset):
            report.dims_unlinked += 1
            continue
        if d.axis is DimensionAxis.HORIZONTAL:
            u = (1.0 if d.b.x >= d.a.x else -1.0, 0.0)
        elif d.axis is DimensionAxis.VERTICAL:
            u = (0.0, 1.0 if d.b.y >= d.a.y else -1.0)
        else:
            vx, vy = d.b.x - d.a.x, d.b.y - d.a.y
            nrm = math.hypot(vx, vy) or 1.0
            u = (vx / nrm, vy / nrm)
        # ((pb + ob) - (pa + oa)) · u = valor
        rhs = d.value - (
            (lb.offset[0] - la.offset[0]) * u[0] + (lb.offset[1] - la.offset[1]) * u[1]
        )
        coefs: dict[int, float] = {}
        for idx, v in ((X(lb.node), u[0]), (Y(lb.node), u[1])):
            coefs[idx] = coefs.get(idx, 0.0) + v
        for idx, v in ((X(la.node), -u[0]), (Y(la.node), -u[1])):
            coefs[idx] = coefs.get(idx, 0.0) + v
        w_dim = max(d.confidence, 0.05) / 0.0005  # sigma de 0,5 mm escalado por la confianza
        sys.add(coefs, rhs, w_dim, "dim", di)
        links[di] = (la, lb, u)
    if not links:
        return level, report

    a_mat = np.vstack(sys.rows)
    b_vec = np.array(sys.rhs)
    base_w = np.array(sys.weights)
    kinds = np.array(sys.kinds)
    wts = base_w.copy()
    x = np.zeros(2 * n)
    for _ in range(8):  # IRLS (Cauchy) sobre las cotas
        sol, *_ = np.linalg.lstsq(a_mat * wts[:, None], b_vec * wts, rcond=None)
        x = sol
        r = a_mat @ x - b_vec
        cauchy = 1.0 / np.sqrt(1.0 + (r / ROBUST) ** 2)
        wts = np.where(kinds == "dim", base_w * cauchy, base_w)

    new_nodes = [Point2D(float(x[2 * k]), float(x[2 * k + 1])) for k in range(n)]
    report.moved_max = max(p.distance_to(q) for p, q in zip(nodes, new_nodes, strict=True))

    # estado de cada cota
    new_dims: list[Dimension] = []
    exact_dims: dict[int, Dimension] = {}
    for di, d in enumerate(level.dimensions):
        if di not in links:
            new_dims.append(d)
            continue
        la, lb, _u = links[di]
        pa = Point2D(new_nodes[la.node].x + la.offset[0], new_nodes[la.node].y + la.offset[1])
        pb = Point2D(new_nodes[lb.node].x + lb.offset[0], new_nodes[lb.node].y + lb.offset[1])
        moved = replace(d, a=pa, b=pb)
        res = moved.measured - d.value
        report.max_residual = max(report.max_residual, abs(res))
        if abs(res) < EXACT_TOL:
            status = MeasureStatus.EXACT
            report.dims_exact += 1
        else:
            status = MeasureStatus.CONFLICT
            report.dims_conflict += 1
            report.conflicts.append(d.text or f"{d.value:.2f}")
        nd = replace(moved, residual=round(res, 4), status=status)
        new_dims.append(nd)
        if status is MeasureStatus.EXACT:
            exact_dims[di] = nd

    # qué muros quedaron fijados por cotas: clases de coordenada (x o y) unidas por cotas
    fixed = _fixed_lengths(walls, ends, nodes, links, exact_dims, tees)
    new_walls: list[Wall] = []
    for wi, wall in enumerate(walls):
        i, j = ends[wi]
        start, end = new_nodes[i], new_nodes[j]
        moved_wall = _moved(wall, start, end)
        if wi in fixed:
            moved_wall = moved_wall.with_measure(
                Measure(MeasureStatus.EXACT, MeasureSource.DIMENSION, EXACT_TOL / 2, fixed[wi])
            )
            report.walls_exact += 1
        new_walls.append(moved_wall)

    disp = {k: (new_nodes[k].x - nodes[k].x, new_nodes[k].y - nodes[k].y) for k in range(n)}
    new_rooms = tuple(_moved_room(r, nodes, disp) for r in level.rooms)
    try:
        out = replace(
            level,
            walls=tuple(new_walls),
            rooms=tuple(r for r in new_rooms if r is not None),
            dimensions=tuple(new_dims),
        )
    except DomainError:
        out = replace(level, walls=tuple(new_walls), dimensions=tuple(new_dims))
    return out, report


def _moved(w: Wall, start: Point2D, end: Point2D) -> Wall:
    """El muro con extremos nuevos: la flecha y las aberturas se adaptan al largo."""
    old_chord = w.chord or 1.0
    new_chord = start.distance_to(end)
    factor = new_chord / old_chord
    bulge = w.bulge * factor
    openings: list[Opening] = []
    try:
        probe = Wall(w.id, start, end, w.thickness, w.height, w.material, (), w.confidence, bulge)
    except DomainError:
        return w
    for o in w.openings:
        if o.end <= probe.length + EPS:
            openings.append(o)
        elif o.width <= probe.length:
            openings.append(replace(o, offset=max(0.0, probe.length - o.width)))
    try:
        return replace(w, start=start, end=end, bulge=bulge, openings=tuple(openings))
    except DomainError:
        return replace(w, start=start, end=end, bulge=bulge, openings=())


def _moved_room(r: Room, nodes: list[Point2D], disp: dict[int, tuple[float, float]]) -> Room | None:
    """Cada vértice se mueve como el nodo más cercano (los ambientes siguen a sus muros)."""

    def move(p: Point2D) -> Point2D:
        k = min(range(len(nodes)), key=lambda k: nodes[k].distance_to(p))
        dx, dy = disp[k]
        return Point2D(p.x + dx, p.y + dy)

    try:
        return replace(
            r,
            polygon=tuple(move(p) for p in r.polygon),
            holes=tuple(tuple(move(p) for p in h) for h in r.holes),
        )
    except DomainError:
        return r


def _fixed_lengths(
    walls: tuple[Wall, ...],
    ends: list[tuple[int, int]],
    nodes: list[Point2D],
    links: dict[int, tuple[_Link, _Link, tuple[float, float]]],
    exact: dict[int, Dimension],
    tees: list[tuple[int, int]],
) -> dict[int, str]:
    """Muros rectos horizontales/verticales cuyo largo quedó determinado por cotas
    exactas: sus dos extremos están en clases de coordenada conectadas por cotas."""
    n = len(nodes)
    out: dict[int, str] = {}
    for axis in ("x", "y"):
        uf = _UnionFind(n)
        # muros perpendiculares al eje comparten coordenada (un muro vertical: misma x)
        for wi, w in enumerate(walls):
            if _across(w, axis):
                uf.union(*ends[wi])
        # un nodo en T sobre un muro perpendicular al eje comparte su coordenada
        for k, wi in tees:
            if _across(walls[wi], axis):
                uf.union(k, ends[wi][0])
        # las cotas exactas sobre ese eje unen clases
        on_axis = [
            (di, d)
            for di, d in exact.items()
            if (axis == "x") == (d.axis is DimensionAxis.HORIZONTAL)
        ]
        for di, _d in on_axis:
            la, lb, _ = links[di]
            uf.union(la.node, lb.node)
        support = {uf.find(links[di][0].node): d.id for di, d in on_axis}
        for wi, w in enumerate(walls):
            if w.is_curved or wi in out or not _along(w, axis):
                continue
            i, j = ends[wi]
            root = uf.find(i)
            if root == uf.find(j) and root in support:
                out[wi] = support[root]
    return out


class _UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def union(self, a: int, b: int) -> None:
        self.parent[self.find(a)] = self.find(b)


def _across(w: Wall, axis: str) -> bool:
    """¿El muro es perpendicular al eje (sus extremos comparten esa coordenada)?"""
    dx, dy = abs(w.end.x - w.start.x), abs(w.end.y - w.start.y)
    return dx < 0.01 * max(dy, EPS) if axis == "x" else dy < 0.01 * max(dx, EPS)


def _along(w: Wall, axis: str) -> bool:
    """¿El muro corre a lo largo del eje (su largo es una diferencia de esa coordenada)?"""
    dx, dy = abs(w.end.x - w.start.x), abs(w.end.y - w.start.y)
    return dx >= 100 * max(dy, EPS) if axis == "x" else dy >= 100 * max(dx, EPS)

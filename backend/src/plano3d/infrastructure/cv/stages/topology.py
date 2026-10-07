"""Topología: une los extremos de los muros en las esquinas y uniones en T.

Cada extremo que queda cerca de la línea central de otro muro (no paralelo) se
lleva a la intersección de ambas rectas. Así el grafo de muros queda cerrado y
las esquinas no se solapan ni dejan huecos.
"""

from __future__ import annotations

from dataclasses import replace

from plano3d.application.pipeline import PipelineStage
from plano3d.infrastructure.cv.context import CVContext, Segment

MIN_ANGLE_DEG = 20.0
SNAP_FACTOR = 1.25


def _line_intersection(s: Segment, o: Segment) -> tuple[float, float] | None:
    x1, y1, x2, y2 = s.x1, s.y1, s.x2, s.y2
    x3, y3, x4, y4 = o.x1, o.y1, o.x2, o.y2
    den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(den) < 1e-9:
        return None
    a = x1 * y2 - y1 * x2
    b = x3 * y4 - y3 * x4
    return ((a * (x3 - x4) - (x1 - x2) * b) / den, (a * (y3 - y4) - (y1 - y2) * b) / den)


def _angle_between(s: Segment, o: Segment) -> float:
    d = abs(s.angle - o.angle) % 180
    return min(d, 180 - d)


def snap_endpoints(segments: list[Segment], wall_thickness: float) -> list[Segment]:
    segs = [
        Segment(s.x1, s.y1, s.x2, s.y2, s.thickness, list(s.openings), s.confidence)
        for s in segments
    ]
    for i, s in enumerate(segs):
        for end in (0, 1):
            ex, ey = (s.x1, s.y1) if end == 0 else (s.x2, s.y2)
            best: tuple[float, tuple[float, float]] | None = None
            for j, o in enumerate(segs):
                if i == j or _angle_between(s, o) < MIN_ANGLE_DEG:
                    continue
                tol = SNAP_FACTOR * max(s.thickness, o.thickness, wall_thickness)
                ox, oy = o.direction
                rel = (ex - o.x1) * ox + (ey - o.y1) * oy
                dist = abs(-(ex - o.x1) * oy + (ey - o.y1) * ox)
                if dist > tol or rel < -tol or rel > o.length + tol:
                    continue
                p = _line_intersection(s, o)
                if p is None:
                    continue
                if best is None or dist < best[0]:
                    best = (dist, p)
            if best is None:
                continue
            nx_, ny_ = best[1]
            if end == 0:
                ux, uy = s.direction
                shift = (nx_ - s.x1) * ux + (ny_ - s.y1) * uy
                s.x1, s.y1 = nx_, ny_
                s.openings = [replace(op, offset=op.offset - shift) for op in s.openings]
            else:
                s.x2, s.y2 = nx_, ny_
    return [_clamp_openings(s) for s in segs if s.length >= 1.5 * wall_thickness or s.openings]


def _clamp_openings(s: Segment) -> Segment:
    kept = []
    for op in s.openings:
        start = max(0.0, op.offset)
        end = min(s.length, op.offset + op.width)
        if end - start > 1.0:
            kept.append(replace(op, offset=start, width=end - start))
    s.openings = kept
    return s


class TopologyStage(PipelineStage[CVContext]):
    key = "topology"
    title = "Topología de muros"

    def run(self, ctx: CVContext) -> CVContext:
        ctx.segments = snap_endpoints(ctx.segments, ctx.wall_thickness_px)
        return ctx

    def metrics(self, ctx: CVContext) -> dict[str, float]:
        total_m = sum(s.length for s in ctx.segments) * ctx.meters_per_pixel
        return {"wall_length_m": round(total_m, 2)}


def dangling_endpoints(segments: list[Segment], tol: float = 1.0) -> int:
    """Cuántos extremos NO tocan ningún otro muro (ni su extremo ni su cuerpo)."""
    count = 0
    for i, s in enumerate(segments):
        for ex, ey in s.endpoints():
            touches = False
            for j, o in enumerate(segments):
                if i == j:
                    continue
                ox, oy = o.direction
                rel = (ex - o.x1) * ox + (ey - o.y1) * oy
                dist = abs(-(ex - o.x1) * oy + (ey - o.y1) * ox)
                if dist <= tol and -tol <= rel <= o.length + tol:
                    touches = True
                    break
            count += not touches
    return count

"""Aberturas: huecos entre tramos colineales del mismo muro → puertas o ventanas.

En un plano, una puerta es un hueco en el muro (con un arco de giro fuera del
muro); una ventana es un hueco cruzado por líneas finas paralelas al muro. Por
eso se mira cuánta tinta fina hay DENTRO de la banda del muro en el hueco.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import cv2
import numpy as np

from plano3d.application.pipeline import PipelineStage
from plano3d.infrastructure.cv.context import CVContext, Img, PxOpening, Segment

MIN_OPENING_M = 0.45
MAX_OPENING_M = 2.6
ANGLE_TOL_DEG = 4.0
WINDOW_INK_RATIO = 0.18


def _angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


@dataclass
class _Piece:
    start: float
    end: float
    offset: float  # desplazamiento normal de la línea central
    thickness: float
    confidence: float
    openings: list[PxOpening]


def _group_collinear(segments: list[Segment], t: float) -> list[tuple[float, list[Segment]]]:
    """Agrupa por dirección y luego por recta (offset normal)."""
    by_angle: list[tuple[float, list[Segment]]] = []
    for s in sorted(segments, key=lambda s: s.angle):
        for ang, group in by_angle:
            if _angle_diff(ang, s.angle) < ANGLE_TOL_DEG:
                group.append(s)
                break
        else:
            by_angle.append((s.angle, [s]))

    lines: list[tuple[float, list[Segment]]] = []
    for ang, group in by_angle:
        nx, ny = -math.sin(math.radians(ang)), math.cos(math.radians(ang))
        keyed = sorted(group, key=lambda s: nx * (s.x1 + s.x2) / 2 + ny * (s.y1 + s.y2) / 2)
        current: list[Segment] = []
        last_c = None
        for s in keyed:
            c = nx * (s.x1 + s.x2) / 2 + ny * (s.y1 + s.y2) / 2
            if last_c is not None and abs(c - last_c) > 0.6 * t:
                lines.append((ang, current))
                current = []
            current.append(s)
            last_c = c
        if current:
            lines.append((ang, current))
    return lines


def classify_gap(
    ink: Img, a: tuple[float, float], b: tuple[float, float], thickness: float
) -> tuple[str, float]:
    """Devuelve (tipo, confianza) mirando la tinta fina dentro de la banda del muro."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    if length < 1:
        return "door", 0.4
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux
    h = thickness * 0.4
    shrink = min(length * 0.15, thickness)  # evita las jambas
    pa = (a[0] + ux * shrink, a[1] + uy * shrink)
    pb = (b[0] - ux * shrink, b[1] - uy * shrink)
    poly = np.array(
        [
            [pa[0] + nx * h, pa[1] + ny * h],
            [pb[0] + nx * h, pb[1] + ny * h],
            [pb[0] - nx * h, pb[1] - ny * h],
            [pa[0] - nx * h, pa[1] - ny * h],
        ]
    )
    band = np.zeros_like(ink)
    cv2.fillPoly(band, [np.round(poly).astype(np.int32)], 255)
    area = int((band > 0).sum())
    if area == 0:
        return "door", 0.4
    ratio = float(((ink > 0) & (band > 0)).sum()) / area
    if ratio >= WINDOW_INK_RATIO:
        return "window", min(0.9, 0.5 + ratio)
    return "door", min(0.9, 0.9 - ratio * 2)


def merge_openings(segments: list[Segment], t: float, mpp: float, ink: Img) -> list[Segment]:
    min_gap = MIN_OPENING_M / mpp
    max_gap = MAX_OPENING_M / mpp
    result: list[Segment] = []
    for ang, group in _group_collinear(segments, t):
        ux, uy = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        nx, ny = -uy, ux
        pieces = []
        for s in group:
            p = [ux * s.x1 + uy * s.y1, ux * s.x2 + uy * s.y2]
            c = nx * (s.x1 + s.x2) / 2 + ny * (s.y1 + s.y2) / 2
            pieces.append(_Piece(min(p), max(p), c, s.thickness, s.confidence, []))
        pieces.sort(key=lambda p: p.start)

        def emit(p: _Piece, ux: float = ux, uy: float = uy, nx: float = nx, ny: float = ny) -> None:
            a = (ux * p.start + nx * p.offset, uy * p.start + ny * p.offset)
            b = (ux * p.end + nx * p.offset, uy * p.end + ny * p.offset)
            result.append(Segment(a[0], a[1], b[0], b[1], p.thickness, p.openings, p.confidence))

        cur = pieces[0]
        for nxt in pieces[1:]:
            gap = nxt.start - cur.end
            similar = 0.5 < nxt.thickness / cur.thickness < 2.0
            if gap <= min_gap or (similar and gap <= max_gap):
                total = (cur.end - cur.start) + (nxt.end - nxt.start)
                w_cur = (cur.end - cur.start) / total if total else 0.5
                merged = _Piece(
                    cur.start,
                    max(cur.end, nxt.end),
                    cur.offset * w_cur + nxt.offset * (1 - w_cur),
                    cur.thickness * w_cur + nxt.thickness * (1 - w_cur),
                    min(cur.confidence, nxt.confidence),
                    cur.openings
                    + [
                        PxOpening(o.offset + (nxt.start - cur.start), o.width, o.kind, o.confidence)
                        for o in nxt.openings
                    ],
                )
                if gap > min_gap:
                    a = (ux * cur.end + nx * cur.offset, uy * cur.end + ny * cur.offset)
                    b = (ux * nxt.start + nx * cur.offset, uy * nxt.start + ny * cur.offset)
                    kind, conf = classify_gap(ink, a, b, merged.thickness)
                    merged.openings.append(PxOpening(cur.end - cur.start, gap, kind, conf))
                cur = merged
            else:
                emit(cur)
                cur = nxt
        emit(cur)
    return result


class OpeningsStage(PipelineStage[CVContext]):
    key = "openings"
    title = "Detección de puertas y ventanas"

    def run(self, ctx: CVContext) -> CVContext:
        ink = ctx.require(ctx.ink, "ink")
        ctx.segments = merge_openings(
            ctx.segments, ctx.wall_thickness_px, ctx.meters_per_pixel, ink
        )
        return ctx

    def metrics(self, ctx: CVContext) -> dict[str, float]:
        ops = [o for s in ctx.segments for o in s.openings]
        return {
            "doors": sum(1 for o in ops if o.kind == "door"),
            "windows": sum(1 for o in ops if o.kind == "window"),
            "wall_count": len(ctx.segments),
        }

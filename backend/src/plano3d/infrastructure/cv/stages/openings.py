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


def _ink_near(ink: Img, x: float, y: float, r: int = 2) -> bool:
    h, w = ink.shape[:2]
    xi, yi = round(x), round(y)
    if not (0 <= xi < w and 0 <= yi < h):
        return False
    return bool(ink[max(0, yi - r) : yi + r + 1, max(0, xi - r) : xi + r + 1].any())


def door_swing_evidence(
    ink: Img, hinge: tuple[float, float], u: tuple[float, float], width: float
) -> float:
    """Cobertura (0..1) del arco de giro o de la hoja de una puerta con bisagra en ``hinge``.

    ``u`` apunta de la bisagra hacia la otra jamba. La hoja abierta queda perpendicular al
    muro (a uno u otro lado) y el arco une su punta con la otra jamba: se muestrean ambos y
    se devuelve la mejor cobertura. Los arcos punteados de muchos planos dan ~0,4-0,6.
    """
    best = 0.0
    for side in (1.0, -1.0):
        n = (-u[1] * side, u[0] * side)
        arc = 0
        steps = 24
        for k in range(1, steps):
            a = math.pi / 2 * k / steps
            px = hinge[0] + width * (u[0] * math.cos(a) + n[0] * math.sin(a))
            py = hinge[1] + width * (u[1] * math.cos(a) + n[1] * math.sin(a))
            arc += _ink_near(ink, px, py)
        leaf = 0
        for k in range(2, 12):
            f = width * k / 12
            leaf += _ink_near(ink, hinge[0] + n[0] * f, hinge[1] + n[1] * f, 1)
        best = max(best, arc / (steps - 1), leaf / 10)
    return best


SWING_EVIDENCE = 0.4
MAX_SWING_DOOR_M = 1.25
WINDOW_LINE_EVIDENCE = 0.8


def window_line_evidence(
    ink: Img, a: tuple[float, float], b: tuple[float, float], thickness: float
) -> float:
    """Cobertura de la mejor línea fina CONTINUA paralela al muro dentro de su banda.

    Una ventana (o una corrediza) se dibuja con líneas que cruzan todo el vano; los muebles
    junto al muro (lavamanos, inodoro, mesones) dejan tinta en la banda pero no una línea
    continua de jamba a jamba.
    """
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    if length < 1:
        return 0.0
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux
    steps = max(8, int(length / 2))
    best = 0.0
    for k in range(-4, 5):
        off = thickness * 0.4 * k / 4
        hits = sum(
            _ink_near(
                ink,
                a[0] + ux * length * s / steps + nx * off,
                a[1] + uy * length * s / steps + ny * off,
                1,
            )
            for s in range(1, steps)
        )
        best = max(best, hits / (steps - 1))
    return best


def bridge_end_gaps(segments: list[Segment], t: float, mpp: float, ink: Img) -> list[Segment]:
    """Huecos entre el EXTREMO de un muro y otro muro (no colineal) más adelante en su eje.

    ``merge_openings`` solo ve huecos entre tramos de la misma recta. Una puerta que va de
    la punta de un tabique hasta un muro transversal (típica de baños y closets) quedaba
    abierta y unía dos ambientes. Aquí se prolonga el muro hasta el otro y el tramo nuevo
    es la abertura, pero solo si la tinta lo respalda: arco u hoja de puerta, o líneas
    finas de ventana/corrediza en la banda. Sin evidencia no se inventa nada (una esquina
    normal también tiene un muro "más adelante").
    """
    min_gap = MIN_OPENING_M / mpp
    max_gap = MAX_OPENING_M / mpp
    out = list(segments)
    # la evidencia (arcos, hojas, líneas de ventana) es tinta FINA: se excluyen los muros,
    # si no la "hoja" muestreada junto a un muro transversal cae dentro de él
    walls = np.zeros_like(ink)
    for w in out:
        # rectángulo exacto del muro (sin puntas redondeadas): la hoja de una puerta suele ir
        # pegada a la cara del muro y no debe quedar tapada
        dx, dy = w.direction
        h = w.thickness / 2
        quad = np.array(
            [
                (w.x1 - dy * h, w.y1 + dx * h),
                (w.x2 - dy * h, w.y2 + dx * h),
                (w.x2 + dy * h, w.y2 - dx * h),
                (w.x1 + dy * h, w.y1 - dx * h),
            ]
        )
        cv2.fillPoly(walls, [np.round(quad).astype(np.int32)], 255)
    thin: Img = np.asarray(cv2.bitwise_and(ink, cv2.bitwise_not(walls)), np.uint8)
    for i, s in enumerate(out):
        for end in (0, 1):
            ex, ey = (s.x2, s.y2) if end else (s.x1, s.y1)
            ux, uy = s.direction if end else (-s.direction[0], -s.direction[1])
            best: tuple[float, float, int] | None = (
                None  # (distancia libre, avance hasta el eje, j)
            )
            for j, o in enumerate(out):
                if j == i or _angle_diff(o.angle, s.angle) < 30:
                    continue
                # intersección del rayo con el eje del otro muro
                ox, oy = o.direction
                den = ux * oy - uy * ox
                if abs(den) < 1e-6:
                    continue
                rx, ry = o.x1 - ex, o.y1 - ey
                along = (rx * oy - ry * ox) / den
                tt = (rx * uy - ry * ux) / den
                if along <= 0 or not (-o.thickness <= tt <= o.length + o.thickness):
                    continue
                free = along - o.thickness / 2
                if free < 0.5 * t:  # ya lo toca: es una unión, no un hueco
                    best = None
                    break
                if min_gap <= free <= max_gap and (best is None or free < best[0]):
                    best = (free, along, j)
            if best is None:
                continue
            free, along, _ = best
            a = (ex, ey)
            b = (ex + ux * free, ey + uy * free)
            kind, conf = classify_gap(ink, a, b, s.thickness)
            swing = max(
                door_swing_evidence(thin, a, (ux, uy), free),
                door_swing_evidence(thin, b, (-ux, -uy), free),
            )
            # una puerta batiente de una hoja no pasa de ~1,25 m; un arco más grande cruza
            # cualquier línea del plano por casualidad
            if swing >= SWING_EVIDENCE and kind == "door" and free * mpp <= MAX_SWING_DOOR_M:
                conf = max(conf, 0.85)
            elif window_line_evidence(thin, a, b, s.thickness) >= WINDOW_LINE_EVIDENCE:
                kind, conf = "window", max(conf, 0.8)
            else:
                continue  # sin arco, hoja ni líneas de ventana: no se inventa la abertura
            nx, ny = ex + ux * along, ey + uy * along
            if end:
                ops = [*s.openings, PxOpening(s.length, free, kind, conf)]
                out[i] = Segment(s.x1, s.y1, nx, ny, s.thickness, ops, s.confidence)
            else:
                shift = along
                ops = [
                    PxOpening(o.offset + shift, o.width, o.kind, o.confidence) for o in s.openings
                ]
                ops.insert(0, PxOpening(along - free, free, kind, conf))
                out[i] = Segment(nx, ny, s.x2, s.y2, s.thickness, ops, s.confidence)
            s = out[i]
    return out


class OpeningsStage(PipelineStage[CVContext]):
    key = "openings"
    title = "Detección de puertas y ventanas"

    def run(self, ctx: CVContext) -> CVContext:
        ink = ctx.require(ctx.ink, "ink")
        segs = merge_openings(ctx.segments, ctx.wall_thickness_px, ctx.meters_per_pixel, ink)
        ctx.segments = bridge_end_gaps(segs, ctx.wall_thickness_px, ctx.meters_per_pixel, ink)
        return ctx

    def metrics(self, ctx: CVContext) -> dict[str, float]:
        ops = [o for s in ctx.segments for o in s.openings]
        return {
            "doors": sum(1 for o in ops if o.kind == "door"),
            "windows": sum(1 for o in ops if o.kind == "window"),
            "wall_count": len(ctx.segments),
        }

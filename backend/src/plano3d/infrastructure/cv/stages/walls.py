"""Detección de muros: máscara de trazos gruesos → segmentos (línea central + grosor)."""

from __future__ import annotations

import cv2
import numpy as np

from plano3d.application.pipeline import PipelineStage
from plano3d.infrastructure.cv.context import CVContext, Img, Segment, as_u8

MIN_WALL_PX = 3.0


def estimate_stroke_thickness(ink: Img) -> float:
    """Grosor (px) del trazo que concentra más tinta, ignorando líneas finas y texto.

    Usa la transformada de distancia: en la cresta de cada trazo, 2·dt ≈ grosor.
    Cada valor se pondera por el propio grosor (≈ área) para que los muros, largos
    y gruesos, dominen sobre el texto.
    """
    dt = cv2.distanceTransform(ink, cv2.DIST_L2, 5)
    ridge = (dt >= cv2.dilate(dt, np.ones((3, 3), np.uint8))) & (dt >= MIN_WALL_PX / 2)
    values = (dt[ridge] * 2.0).astype(np.float64)
    values = values[values < max(ink.shape) / 8]
    if values.size == 0:
        return 0.0
    bins = np.arange(np.floor(MIN_WALL_PX), values.max() + 2)
    hist, edges = np.histogram(values, bins=bins, weights=values)
    # suaviza para que un grosor que cae entre dos bins no se divida
    smooth = np.convolve(hist, [1, 2, 1], mode="same")
    mode = (edges[np.argmax(smooth)] + edges[np.argmax(smooth) + 1]) / 2
    near = values[(values > mode * 0.6) & (values < mode * 1.6)]
    return float(np.median(near)) if near.size else float(mode)


def thick_strokes(ink: Img, thickness: float) -> Img:
    """Apertura morfológica: sobreviven solo los trazos al menos tan gruesos como ~60% del muro."""
    k = max(2, round(thickness * 0.6))
    return as_u8(
        cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    )


def extract_wall_mask(ink: Img, thickness: float) -> Img:
    walls = thick_strokes(ink, thickness)
    # descarta manchas compactas (letras en negrita, logos): un muro es alargado
    n, labels, stats, _ = cv2.connectedComponentsWithStats(walls, connectivity=8)
    keep = np.zeros(n, np.uint8)
    for i in range(1, n):
        longest = max(stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT])
        if longest >= 3 * thickness:
            keep[i] = 255
    return as_u8(keep[labels])


class WallMaskStage(PipelineStage[CVContext]):
    key = "walls"
    title = "Detección de muros"

    def run(self, ctx: CVContext) -> CVContext:
        ink = ctx.require(ctx.ink, "ink")
        t = estimate_stroke_thickness(ink)
        if t < MIN_WALL_PX:
            raise ValueError("No se encontraron trazos de muro en la imagen")
        ctx.wall_mask = extract_wall_mask(ink, t)
        ctx.wall_thickness_px = t
        return ctx

    def metrics(self, ctx: CVContext) -> dict[str, float]:
        mask = ctx.require(ctx.wall_mask, "wall_mask")
        return {
            "wall_thickness_px": round(ctx.wall_thickness_px, 2),
            "wall_ratio": float((mask > 0).mean()),
        }


# --------------------------------------------------------------------------- vectorize


def _axis_segments(mask: Img, t: float, horizontal: bool) -> list[Segment]:
    length = max(round(3 * t), 5)
    ksize = (length, 1) if horizontal else (1, length)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, ksize)
    runs = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(runs, connectivity=8)
    out: list[Segment] = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        long_side, short_side = (w, h) if horizontal else (h, w)
        if long_side < 2 * t or short_side > 3 * t:
            continue
        ys, xs = np.nonzero(labels[y : y + h, x : x + w] == i)
        thickness = float(area) / float(long_side)
        if horizontal:
            cy = y + float(ys.mean()) + 0.5
            out.append(Segment(x, cy, x + w, cy, thickness))
        else:
            cx = x + float(xs.mean()) + 0.5
            out.append(Segment(cx, y, cx, y + h, thickness))
    return out


def _diagonal_segments(mask: Img, axis_mask: Img, t: float) -> list[Segment]:
    grow = cv2.dilate(axis_mask, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
    residual = cv2.bitwise_and(mask, cv2.bitwise_not(grow))
    residual = cv2.morphologyEx(
        residual, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    )
    contours, _ = cv2.findContours(residual, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    out: list[Segment] = []
    for c in contours:
        if cv2.contourArea(c) < 4 * t * t:
            continue
        (cx, cy), (w, h), ang = cv2.minAreaRect(c)
        long_side, short_side = max(w, h), min(w, h)
        if long_side < 3 * t or short_side > 2 * t or short_side < 0.4 * t:
            continue
        theta = np.deg2rad(ang if w >= h else ang + 90)
        dx, dy = np.cos(theta) * long_side / 2, np.sin(theta) * long_side / 2
        out.append(Segment(cx - dx, cy - dy, cx + dx, cy + dy, short_side, confidence=0.6))
    return out


#: hasta dónde (en grosores de muro) un tramo corto alineado con otro sigue siendo su muro
SHORT_PIECE_REACH = 12.0


def _short_pieces(thick: Img, axis_mask: Img, segments: list[Segment], t: float) -> list[Segment]:
    """Tramos rectos más cortos que 3 grosores: jambas junto a una puerta, montantes entre
    ventanas. Solo se aceptan si tocan un muro ya hallado o siguen su eje (un mueble suelto
    queda fuera)."""
    grow = cv2.dilate(axis_mask, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
    residual = cv2.bitwise_and(thick, cv2.bitwise_not(grow))
    n, _, stats, _ = cv2.connectedComponentsWithStats(residual, connectivity=8)
    out: list[Segment] = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        horizontal = w >= h
        long_side, short_side = (w, h) if horizontal else (h, w)
        if not (1.2 * t <= long_side < 3.5 * t and 0.5 * t <= short_side <= 1.6 * t):
            continue
        if area < 0.6 * w * h:
            continue  # no es un rectángulo macizo
        cx, cy = x + w / 2, y + h / 2
        piece = (
            Segment(x, cy, x + w, cy, area / w)
            if horizontal
            else Segment(cx, y, cx, y + h, area / h)
        )
        if any(_attached(piece, s, t) for s in segments):
            out.append(piece)
    return out


def _attached(p: Segment, s: Segment, t: float) -> bool:
    ph = abs(p.y2 - p.y1) < abs(p.x2 - p.x1)
    sh = abs(s.y2 - s.y1) < abs(s.x2 - s.x1)
    if abs(s.angle % 90) > 3 and abs(s.angle % 90) < 87:
        return False
    if ph == sh:
        # mismo eje: el tramo corto sigue la línea del muro, con un vano razonable
        if ph:
            off, a0, a1, b0, b1 = abs(p.y1 - s.y1), p.x1, p.x2, min(s.x1, s.x2), max(s.x1, s.x2)
        else:
            off, a0, a1, b0, b1 = abs(p.x1 - s.x1), p.y1, p.y2, min(s.y1, s.y2), max(s.y1, s.y2)
        gap = max(b0 - a1, a0 - b1)
        return off <= t / 2 and gap <= SHORT_PIECE_REACH * t
    # perpendicular: un extremo del tramo corto toca la cara del muro (jamba en T)
    if ph:
        wx, y0, y1 = s.x1, min(s.y1, s.y2), max(s.y1, s.y2)
        near_end = min(abs(p.x1 - wx), abs(p.x2 - wx)) <= s.thickness / 2 + t / 2
        return near_end and y0 - t <= p.y1 <= y1 + t
    wy, x0, x1 = s.y1, min(s.x1, s.x2), max(s.x1, s.x2)
    near_end = min(abs(p.y1 - wy), abs(p.y2 - wy)) <= s.thickness / 2 + t / 2
    return near_end and x0 - t <= p.x1 <= x1 + t


def vectorize(mask: Img, t: float, thick: Img | None = None) -> list[Segment]:
    """Muros rectos de la máscara; ``thick`` (tinta gruesa sin filtrar por largo) permite
    rescatar los tramos cortos que la máscara de muros descartó."""
    horiz = _axis_segments(mask, t, horizontal=True)
    vert = _axis_segments(mask, t, horizontal=False)
    axis_mask = np.zeros_like(mask)
    for s in horiz + vert:
        draw_segment(axis_mask, s, extend=True)
    short = _short_pieces(mask if thick is None else thick, axis_mask, horiz + vert, t)
    for s in short:
        draw_segment(axis_mask, s, extend=True)
    return horiz + vert + short + _diagonal_segments(mask, axis_mask, t)


def segment_polygon(s: Segment, extend: bool) -> np.ndarray:
    dx, dy = s.direction
    nx, ny = -dy, dx
    h = s.thickness / 2
    e = h if extend else 0.0
    ax, ay = s.x1 - dx * e, s.y1 - dy * e
    bx, by = s.x2 + dx * e, s.y2 + dy * e
    return np.array(
        [
            [ax + nx * h, ay + ny * h],
            [bx + nx * h, by + ny * h],
            [bx - nx * h, by - ny * h],
            [ax - nx * h, ay - ny * h],
        ],
        np.float64,
    )


def draw_segment(mask: Img, s: Segment, extend: bool = True, value: int = 255) -> None:
    pts = np.round(segment_polygon(s, extend)).astype(np.int32)
    cv2.fillPoly(mask, [pts], value)


class VectorizeStage(PipelineStage[CVContext]):
    key = "vectorize"
    title = "Vectorización de muros"

    def run(self, ctx: CVContext) -> CVContext:
        mask = ctx.require(ctx.wall_mask, "wall_mask")
        thick = thick_strokes(ctx.require(ctx.ink, "ink"), ctx.wall_thickness_px)
        ctx.segments = vectorize(mask, ctx.wall_thickness_px, thick)
        if not ctx.segments:
            raise ValueError("No se pudo vectorizar ningún muro")
        return ctx

    def metrics(self, ctx: CVContext) -> dict[str, float]:
        return {"segment_count": len(ctx.segments)}

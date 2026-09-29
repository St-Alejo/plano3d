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


def extract_wall_mask(ink: Img, thickness: float) -> Img:
    """Apertura morfológica: sobreviven solo los trazos al menos tan gruesos como ~60% del muro."""
    k = max(2, round(thickness * 0.6))
    walls = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
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


def vectorize(mask: Img, t: float) -> list[Segment]:
    horiz = _axis_segments(mask, t, horizontal=True)
    vert = _axis_segments(mask, t, horizontal=False)
    axis_mask = np.zeros_like(mask)
    for s in horiz + vert:
        draw_segment(axis_mask, s, extend=True)
    return horiz + vert + _diagonal_segments(mask, axis_mask, t)


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


def draw_segment(mask: Img, s: Segment, extend: bool = True) -> None:
    pts = np.round(segment_polygon(s, extend)).astype(np.int32)
    cv2.fillPoly(mask, [pts], 255)


class VectorizeStage(PipelineStage[CVContext]):
    key = "vectorize"
    title = "Vectorización de muros"

    def run(self, ctx: CVContext) -> CVContext:
        mask = ctx.require(ctx.wall_mask, "wall_mask")
        ctx.segments = vectorize(mask, ctx.wall_thickness_px)
        if not ctx.segments:
            raise ValueError("No se pudo vectorizar ningún muro")
        return ctx

    def metrics(self, ctx: CVContext) -> dict[str, float]:
        return {"segment_count": len(ctx.segments)}

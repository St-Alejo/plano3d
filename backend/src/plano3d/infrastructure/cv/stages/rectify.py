"""Rectificación de perspectiva: convierte la foto del papel en una vista cenital."""

from __future__ import annotations

import cv2
import numpy as np
import numpy.typing as npt

from plano3d.application.pipeline import PipelineStage
from plano3d.infrastructure.cv.context import CVContext, Img, as_u8

Quad = npt.NDArray[np.float64]  # (4, 2) TL, TR, BR, BL


def order_corners(pts: npt.ArrayLike) -> Quad:
    """Ordena 4 puntos cualesquiera como TL, TR, BR, BL."""
    p = np.asarray(pts, np.float64).reshape(4, 2)
    s = p.sum(axis=1)
    d = np.diff(p, axis=1).ravel()  # y - x
    return np.array([p[np.argmin(s)], p[np.argmin(d)], p[np.argmax(s)], p[np.argmax(d)]])


def find_paper_quad(img: Img) -> Quad | None:
    """Busca el cuadrilátero claro más grande (la hoja). None si no hay uno convincente."""
    h, w = img.shape[:2]
    f = 800 / max(h, w) if max(h, w) > 800 else 1.0
    small = cv2.resize(img, (round(w * f), round(h * f))) if f != 1.0 else img
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    _, bright = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # rellena los trazos oscuros del dibujo para que la hoja sea una sola mancha
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, k)
    contours, _ = cv2.findContours(bright, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    c = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(c)
    img_area = small.shape[0] * small.shape[1]
    if area < 0.15 * img_area or area > 0.97 * img_area:
        return None  # no hay hoja, o la hoja ya ocupa toda la imagen (escaneo)
    hull = cv2.convexHull(c)
    peri = cv2.arcLength(hull, True)
    for eps in (0.01, 0.02, 0.03, 0.05, 0.08):
        approx = cv2.approxPolyDP(hull, eps * peri, True)
        if len(approx) == 4:
            return order_corners(approx.reshape(4, 2) / f)
    return None


def warp(img: Img, quad: Quad, inset: float = 0.004) -> Img:
    tl, tr, br, bl = quad
    width = round(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
    height = round(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
    dst = np.array([[0, 0], [width, 0], [width, height], [0, height]], np.float32)
    m = cv2.getPerspectiveTransform(quad.astype(np.float32), dst)
    out = cv2.warpPerspective(
        img, m, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )
    dx, dy = int(width * inset), int(height * inset)
    return as_u8(out[dy : height - dy, dx : width - dx].copy())


class RectifyStage(PipelineStage[CVContext]):
    key = "rectify"
    title = "Corrección de perspectiva"

    def run(self, ctx: CVContext) -> CVContext:
        img = ctx.require(ctx.original, "original")
        h, w = img.shape[:2]
        quad: Quad | None
        if ctx.corners:
            quad = order_corners(np.array(ctx.corners, np.float64) * np.array([w, h]))
        else:
            quad = find_paper_quad(img)
        if quad is None:
            ctx.rectified = img
            ctx.paper_detected = False
        else:
            ctx.rectified = warp(img, quad)
            ctx.paper_detected = True
        return ctx

    def metrics(self, ctx: CVContext) -> dict[str, float]:
        return {"paper_detected": float(ctx.paper_detected)}

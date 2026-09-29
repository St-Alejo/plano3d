"""Preprocesado: iluminación uniforme → binarización → limpieza → corrección de inclinación."""

from __future__ import annotations

import math

import cv2
import numpy as np

from plano3d.application.pipeline import PipelineStage
from plano3d.infrastructure.cv.context import CVContext, Img, as_u8


def normalize_illumination(gray: Img) -> Img:
    """Divide por el fondo estimado: elimina sombras y gradientes de luz de la foto."""
    k = max(15, (max(gray.shape) // 25) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    background = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel)  # borra la tinta
    background = cv2.GaussianBlur(background, (0, 0), k / 3)
    norm = gray.astype(np.float32) / np.maximum(background.astype(np.float32), 1.0) * 255.0
    return np.clip(norm, 0, 255).astype(np.uint8)


def binarize(norm: Img) -> Img:
    """255 = tinta. Otsu acotado para que un plano casi vacío no se vuelva todo negro."""
    otsu, _ = cv2.threshold(norm, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    thr = float(np.clip(otsu, 110, 200))
    _, ink = cv2.threshold(norm, thr, 255, cv2.THRESH_BINARY_INV)
    return as_u8(ink)


def remove_specks(ink: Img, min_area: int) -> Img:
    n, labels, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    keep = np.zeros(n, np.uint8)
    keep[1:] = (stats[1:, cv2.CC_STAT_AREA] >= min_area).astype(np.uint8) * 255
    return as_u8(keep[labels])


def clear_border(ink: Img, ratio: float = 0.01) -> Img:
    """Quita restos del borde del papel o de la mesa que sobreviven a la rectificación."""
    h, w = ink.shape
    by, bx = max(1, int(h * ratio)), max(1, int(w * ratio))
    out = ink.copy()
    out[:by, :] = 0
    out[-by:, :] = 0
    out[:, :bx] = 0
    out[:, -bx:] = 0
    return out


def dominant_skew(ink: Img) -> float:
    """Ángulo (grados) que hay que rotar para que los trazos largos queden a 0/90°."""
    min_len = max(ink.shape) // 8
    lines = cv2.HoughLinesP(ink, 1, np.pi / 720, threshold=80, minLineLength=min_len, maxLineGap=5)
    if lines is None:
        return 0.0
    deviations, weights = [], []
    for x1, y1, x2, y2 in lines.reshape(-1, 4):
        ang = math.degrees(math.atan2(y2 - y1, x2 - x1))
        dev = ((ang + 45) % 90) - 45  # desvío respecto al eje más cercano
        if abs(dev) < 10:
            deviations.append(dev)
            weights.append(math.hypot(x2 - x1, y2 - y1))
    if not deviations:
        return 0.0
    order = np.argsort(deviations)
    cum = np.cumsum(np.asarray(weights)[order])
    median = float(np.asarray(deviations)[order][np.searchsorted(cum, cum[-1] / 2)])
    return median


def rotate(img: Img, degrees: float, border: int) -> Img:
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), degrees, 1.0)
    return as_u8(cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_LINEAR, borderValue=border))


class PreprocessStage(PipelineStage[CVContext]):
    key = "preprocess"
    title = "Limpieza y binarización"

    def __init__(self, deskew_threshold_deg: float = 0.3) -> None:
        self._deskew_threshold = deskew_threshold_deg

    def run(self, ctx: CVContext) -> CVContext:
        img = ctx.require(ctx.rectified, "rectified")
        gray = as_u8(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
        ink = binarize(normalize_illumination(gray))
        ink = clear_border(ink)
        min_area = max(4, int(ink.size * 2e-6))
        ink = remove_specks(ink, min_area)

        skew = dominant_skew(ink)
        ctx.metrics["skew_deg"] = round(skew, 2)
        if abs(skew) > self._deskew_threshold:
            ctx.rectified = rotate(img, skew, border=255)
            ink = rotate(ink, skew, border=0)
            ink = as_u8(cv2.threshold(ink, 127, 255, cv2.THRESH_BINARY)[1])
        ctx.ink = ink
        return ctx

    def metrics(self, ctx: CVContext) -> dict[str, float]:
        ink = ctx.require(ctx.ink, "ink")
        return {"ink_ratio": float((ink > 0).mean()), "skew_deg": ctx.metrics.get("skew_deg", 0.0)}

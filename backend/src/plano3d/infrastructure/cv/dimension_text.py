"""Cotas "texto primero": se lee la hoja entera y, bajo cada número, se mide su línea.

La ruta de ``dimensions`` (línea primero) busca trazos con marcas en los dos extremos y
luego lee el texto. En fotos de celular falla: el papel curvado parte y tuerce las líneas,
los ticks miden 4-5 px y dos cadenas paralelas parecen las caras de un muro. Aquí se invierte
el orden, porque el OCR de la hoja entera sí encuentra los números:

1. ``TextSpotter`` sobre la imagen y sobre la imagen girada 90° (cotas verticales).
2. Para cada texto que es una longitud, la línea de cota es la fila de tinta continua más
   cercana, justo debajo (o encima) del texto.
3. Se sigue esa línea desde el texto hacia cada lado, tolerando la curvatura, hasta la
   primera marca (tick, flecha o línea de extensión que la cruza) o hasta donde termina.
4. Los pares (largo en px, metros) van al mismo consenso RANSAC de ``scale_fit``.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import cv2
import numpy as np

from plano3d.application.ports import SpottedText, TextSpotter
from plano3d.domain.plan_text import parse_length
from plano3d.infrastructure.cv.context import Img, as_u8

#: fracción de la ventana (fuera del texto) que la fila de la línea debe tener con tinta
MIN_LINE_FILL = 0.55
#: hueco (en alturas de texto) que se tolera al seguir una línea cortada
MAX_GAP_H = 0.6


@dataclass(frozen=True)
class TextDimension:
    """Una cota medida: texto leído, valor(es) posibles y extremos en px de la imagen."""

    text: str
    meters: tuple[float, ...]  # un entero sin unidad puede ser cm o m: compiten
    confidence: float
    p1: tuple[float, float]
    p2: tuple[float, float]
    center: tuple[float, float]

    @property
    def length(self) -> float:
        return float(np.hypot(self.p2[0] - self.p1[0], self.p2[1] - self.p1[1]))


def _values(text: str) -> tuple[float, ...]:
    parsed = parse_length(text.replace(" ", ""))
    if parsed is None:
        return ()
    values = [parsed.meters]
    if parsed.ambiguous:
        values.append(parsed.meters * 100)
    return tuple(v for v in values if 0.1 <= v <= 200)


def _line_row(ink: Img, cx: float, cy: float, half_w: float, h: float) -> int | None:
    """Fila de la línea de cota bajo (o sobre) el texto: la más llena de tinta a los lados
    del texto, entre 0,3 y 1,6 alturas de texto del centro."""
    rows, cols = ink.shape
    span = int(half_w + 3 * h)
    x0, x1 = max(0, int(cx - span)), min(cols, int(cx + span))
    t0, t1 = int(cx - half_w - 1), int(cx + half_w + 1)
    mask = np.ones(x1 - x0, bool)
    mask[max(0, t0 - x0) : max(0, t1 - x0)] = False
    if mask.sum() < 4:
        return None
    best: tuple[float, float, int] | None = None
    for off in range(max(2, int(0.3 * h)), int(1.6 * h) + 2):
        for y in (round(cy + off), round(cy - off)):
            if not 0 <= y < rows:
                continue
            # la fila más llena entre y y sus vecinas (la línea puede ir torcida)
            band = ink[max(0, y - 1) : y + 2, x0:x1].max(axis=0) > 0
            fill = float(band[mask].mean())
            if fill >= MIN_LINE_FILL and (best is None or (fill, -off) > best[:2]):
                best = (fill, -off, y)
    return None if best is None else best[2]


def _crosses(ink: Img, x: int, y: int, need: int) -> bool:
    """¿La tinta sale perpendicular a la línea en la columna ``x`` (tick, flecha, extensión)?"""
    rows = ink.shape[0]
    up = 0
    while y - 2 - up >= 0 and ink[y - 2 - up, x] > 0:
        up += 1
    down = 0
    while y + 2 + down < rows and ink[y + 2 + down, x] > 0:
        down += 1
    return up + down + 3 >= need


def _follow(ink: Img, x: int, y: int) -> int | None:
    """Fila de la línea en la columna ``x``, cerca de ``y`` (la línea puede ir torcida)."""
    rows = ink.shape[0]
    for d in (0, -1, 1, -2, 2):
        if 0 <= y + d < rows and ink[y + d, x] > 0:
            return y + d
    return None


def _walk(ink: Img, x: int, y: int, step: int, skip: float, h: float) -> tuple[int, int] | None:
    """Sigue la línea desde (x, y) en la dirección ``step`` hasta su primera marca o su fin.
    ``skip``: px iniciales donde se ignoran cruces (el propio texto toca la línea).

    La marca se toma en su primer cruce: una línea de extensión queda exacta y un tick a 45°
    ~2 px antes de su centro. Buscar el centro con la tinta vecina sale peor en fotos reales,
    porque junto a la marca suele estar el texto de la cota siguiente (".30" tras un tick)."""
    cols = ink.shape[1]
    need = max(4, int(0.6 * h))
    gap_max = max(4, int(MAX_GAP_H * h))
    gap = 0
    last = (x, y)
    k = 0
    while 0 <= x + step < cols:
        x += step
        k += 1
        hit = _follow(ink, x, y)
        if hit is None:
            gap += 1
            if gap > gap_max:
                return last  # la línea terminó (o la cortó un hueco largo)
            continue
        gap = 0
        y = hit
        last = (x, y)
        if k <= skip or not _crosses(ink, x, y, need):
            continue
        return (x, y)
    return last


Segment = tuple[tuple[float, float], tuple[float, float]]


def measure_text(ink: Img, s: SpottedText) -> Segment | None:
    """Extremos (px) de la línea de cota del texto ``s`` (texto horizontal)."""
    h = max(4.0, s.height)
    half_w = max(s.width / 2, h / 2)
    row = _line_row(ink, s.x, s.y, half_w, h)
    if row is None:
        return None
    x = round(s.x)
    skip = half_w + 2
    left = _walk(ink, x, row, -1, skip, h)
    right = _walk(ink, x, row, 1, skip, h)
    if left is None or right is None:
        return None
    if right[0] - left[0] < max(0.8 * s.width, 2 * h):
        return None  # más corta que su propio texto: no es la línea de esta cota
    return (float(left[0]), float(left[1])), (float(right[0]), float(right[1]))


def read_text_dimensions(
    image: Img, ink: Img, spotter: TextSpotter, spotted: Sequence[SpottedText] | None = None
) -> list[TextDimension]:
    """Cotas horizontales y verticales medidas a partir de los textos de la hoja."""
    rows = ink.shape[0]
    out: list[TextDimension] = []
    horizontal = spotted if spotted is not None else spotter.spot(image)
    for s in horizontal:
        values = _values(s.text)
        if not values:
            continue
        got = measure_text(ink, s)
        if got is not None:
            out.append(TextDimension(s.text, values, s.confidence, got[0], got[1], (s.x, s.y)))
    # cotas verticales (se leen de abajo hacia arriba): se gira la hoja 90° a la derecha.
    # Punto girado (u, v) -> original (x, y) = (v, rows - 1 - u)
    rot_img = as_u8(cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE))
    rot_ink = as_u8(cv2.rotate(ink, cv2.ROTATE_90_CLOCKWISE))

    def back(p: tuple[float, float]) -> tuple[float, float]:
        return (p[1], rows - 1 - p[0])

    for s in spotter.spot(rot_img):
        values = _values(s.text)
        if not values:
            continue
        got = measure_text(rot_ink, s)
        if got is not None:
            out.append(
                TextDimension(
                    s.text, values, s.confidence, back(got[0]), back(got[1]), back((s.x, s.y))
                )
            )
    return out

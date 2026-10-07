"""Análisis de lámina: separa la hoja en bloques y descarta los que no son dibujo.

Muchas láminas traen, además de la planta, una foto o render de la fachada, el cajetín o
leyendas. Si todo entra al detector, la foto aporta "muros" (aristas de palmeras, ventanas)
y ambientes inventados. Aquí la hoja se corta por las franjas vacías (cortes XY recursivos)
y cada bloque se clasifica: una FOTO tiene muchos colores distintos y casi nada de superficie
plana (ruido, follaje, cielo degradado); un dibujo —técnico, CAD o render de planta— está
hecho de rellenos planos y trazos. Se conserva el bloque de dibujo más grande.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise

import cv2
import numpy as np

from plano3d.application.pipeline import PipelineStage
from plano3d.infrastructure.cv.context import CVContext, Img, as_u8

Box = tuple[int, int, int, int]  # x0, y0, x1, y1

EDGE_THRESHOLD = 40.0
#: una fila/columna es "vacía" si casi no tiene aristas (tolera ruido de JPEG)
EMPTY_FRACTION = 0.003
MIN_BLOCK_FRACTION = 0.05
PHOTO_MIN_COLORS = 120
PHOTO_MAX_FLAT = 0.45


@dataclass(frozen=True)
class Block:
    box: Box
    kind: str  # "drawing" | "photo"
    colors: int
    flat: float

    @property
    def area(self) -> int:
        x0, y0, x1, y1 = self.box
        return (x1 - x0) * (y1 - y0)


def _gaps(profile: np.ndarray, min_gap: int) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    start: int | None = None
    for i, empty in enumerate(profile < EMPTY_FRACTION):
        if empty and start is None:
            start = i
        elif not empty and start is not None:
            if i - start >= min_gap and start > 0:
                out.append((start, i))
            start = None
    return out


def _cut(edges: np.ndarray, box: Box, depth: int, out: list[Box]) -> None:
    x0, y0, x1, y1 = box
    sub = edges[y0:y1, x0:x1]
    h, w = sub.shape
    if depth < 4:
        for axis in (0, 1):
            n = h if axis == 0 else w
            profile = sub.mean(axis=1) if axis == 0 else sub.mean(axis=0)
            gaps = _gaps(profile, max(4, int(0.004 * n)))
            if gaps:
                cuts = [0, *((a + b) // 2 for a, b in gaps), n]
                for a, b in pairwise(cuts):
                    part = (x0, y0 + a, x1, y0 + b) if axis == 0 else (x0 + a, y0, x0 + b, y1)
                    _cut(edges, part, depth + 1, out)
                return
    out.append(box)


def _classify(img: Img, box: Box) -> Block:
    x0, y0, x1, y1 = box
    crop = img[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY).astype(np.float32)
    mean = cv2.blur(gray, (5, 5))
    sd = np.sqrt(np.maximum(cv2.blur(gray * gray, (5, 5)) - mean * mean, 0))
    flat = float((sd < 3).mean())
    q = (crop // 32).reshape(-1, 3).astype(np.int32)
    colors = len(np.unique(q[:, 0] * 64 + q[:, 1] * 8 + q[:, 2]))
    photo = colors >= PHOTO_MIN_COLORS and flat < PHOTO_MAX_FLAT
    return Block(box, "photo" if photo else "drawing", colors, round(flat, 3))


def analyze_sheet(img: Img) -> list[Block]:
    """Bloques de la hoja (de al menos el 5 % del área), ya clasificados."""
    if img.ndim == 2:
        img = as_u8(cv2.cvtColor(img, cv2.COLOR_GRAY2BGR))
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mag = cv2.magnitude(cv2.Sobel(gray, cv2.CV_32F, 1, 0), cv2.Sobel(gray, cv2.CV_32F, 0, 1))
    boxes: list[Box] = []
    _cut((mag > EDGE_THRESHOLD).astype(np.float32), (0, 0, w, h), 0, boxes)
    blocks = [_classify(img, b) for b in boxes]
    return [b for b in blocks if b.area >= MIN_BLOCK_FRACTION * h * w]


def drawing_box(img: Img) -> Box | None:
    """Recorte de la planta si la hoja tiene bloques fotográficos que conviene descartar."""
    blocks = analyze_sheet(img)
    if not any(b.kind == "photo" for b in blocks):
        return None
    drawings = [b for b in blocks if b.kind == "drawing"]
    if not drawings:
        return None  # todo parece foto: mejor no recortar nada
    h, w = img.shape[:2]
    best = max(drawings, key=lambda b: b.area)
    return best.box if best.area >= 0.25 * h * w else None


#: brillo mediano por debajo del cual la lámina es "CAD de fondo oscuro"
DARK_SHEET_V = 100
#: una línea que cruza casi toda la hoja es el marco o la división del cajetín
FRAME_SPAN = 0.85


def is_dark_sheet(img: Img) -> bool:
    if img.ndim == 2:
        return float(np.median(img)) < DARK_SHEET_V
    return float(np.median(cv2.cvtColor(img, cv2.COLOR_BGR2HSV)[..., 2])) < DARK_SHEET_V


def normalize_dark_sheet(img: Img) -> Img:
    """CAD de fondo oscuro → papel blanco con tinta negra.

    Por convención de capas, los trazos neutros claros son muros, muebles y textos, y los
    azules suelen ser puertas y ventanas: ambos pasan a tinta. Rojo, verde, amarillo y
    magenta son ejes, cotas, vegetación y rótulos de ejes: se descartan.
    """
    if img.ndim == 2:
        out = np.full(img.shape, 255, np.uint8)
        out[img > 110] = 0
        return as_u8(cv2.cvtColor(out, cv2.COLOR_GRAY2BGR))
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    neutral = (v > 110) & (s < 70)
    blue = (h >= 90) & (h <= 130) & (s > 100) & (v > 100)
    out = np.full(img.shape, 255, np.uint8)
    out[neutral | blue] = 0
    return as_u8(out)


def remove_frame(img: Img) -> Img:
    """Borra las líneas que cruzan casi toda la hoja (marco, división del cajetín)."""
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    ink = (gray < 128).astype(np.uint8) * 255
    h, w = ink.shape
    lines = np.zeros_like(ink)
    for size in ((max(3, int(FRAME_SPAN * w)), 1), (1, max(3, int(FRAME_SPAN * h)))):
        k = cv2.getStructuringElement(cv2.MORPH_RECT, size)
        lines = as_u8(cv2.bitwise_or(lines, cv2.morphologyEx(ink, cv2.MORPH_OPEN, k)))
    out = img.copy()
    out[cv2.dilate(lines, np.ones((3, 3), np.uint8)) > 0] = 255
    return as_u8(out)


def prepare_sheet(img: Img) -> Img:
    """Lámina lista para separar dibujos: papel claro y sin marco."""
    if img.ndim == 2:
        img = as_u8(cv2.cvtColor(img, cv2.COLOR_GRAY2BGR))
    if is_dark_sheet(img):
        img = normalize_dark_sheet(img)
    return remove_frame(img)


def _ink_bbox(img: Img, box: Box) -> Box:
    x0, y0, x1, y1 = box
    gray = img[y0:y1, x0:x1]
    if gray.ndim == 3:
        gray = as_u8(cv2.cvtColor(gray, cv2.COLOR_BGR2GRAY))
    ys, xs = np.nonzero(gray < 128)
    if not len(xs):
        return box
    return (x0 + int(xs.min()), y0 + int(ys.min()), x0 + int(xs.max()) + 1, y0 + int(ys.max()) + 1)


def plan_blocks(sheet: Img) -> list[Box]:
    """Recuadros (ajustados a la tinta) de cada planta dibujada en la lámina, en orden de
    lectura. Se descartan fotos, el cajetín (muy angosto) y bloques mucho menores que la
    planta principal (leyendas, sellos)."""
    drawings = [b for b in analyze_sheet(sheet) if b.kind == "drawing"]
    if not drawings:
        return []
    boxes = [_ink_bbox(sheet, b.box) for b in drawings]

    def aspect(b: Box) -> float:
        return (b[2] - b[0]) / max(1, b[3] - b[1])

    def area(b: Box) -> int:
        return (b[2] - b[0]) * (b[3] - b[1])

    biggest = max(area(b) for b in boxes)
    plans = [b for b in boxes if area(b) >= 0.3 * biggest and 0.3 <= aspect(b) <= 3.3]
    return sorted(plans, key=lambda b: (round(b[1] / max(1, sheet.shape[0] / 4)), b[0]))


class SheetLayoutStage(PipelineStage[CVContext]):
    key = "layout"
    title = "Análisis de la lámina"

    def __init__(self) -> None:
        self._cropped = 0.0

    def run(self, ctx: CVContext) -> CVContext:
        img = ctx.require(ctx.original, "original")
        if is_dark_sheet(img):
            # CAD de fondo oscuro: el resto del pipeline espera tinta oscura sobre papel
            img = ctx.original = remove_frame(normalize_dark_sheet(img))
        box = drawing_box(img)
        self._cropped = 0.0
        if box is not None:
            x0, y0, x1, y1 = box
            ctx.original = img[y0:y1, x0:x1].copy()
            ctx.then(np.array([[1, 0, -x0], [0, 1, -y0], [0, 0, 1]], np.float64))
            self._cropped = 1.0 - (x1 - x0) * (y1 - y0) / (img.shape[0] * img.shape[1])
        return ctx

    def metrics(self, ctx: CVContext) -> dict[str, float]:
        return {"discarded_fraction": round(self._cropped, 3)}

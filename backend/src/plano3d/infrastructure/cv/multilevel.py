"""Láminas con varias plantas dibujadas lado a lado → un modelo con niveles apilados.

Es un Decorator de otro detector: si el análisis de lámina encuentra dos o más plantas, las
recorta, detecta cada una por separado, las alinea entre sí (por solape de sus trazos
largos: los muros de fachada y los linderos se repiten de un piso a otro), unifica la
escala y las apila como niveles. Con una sola planta delega sin tocar nada.
"""

from __future__ import annotations

import logging
import math
from dataclasses import replace

import cv2
import numpy as np
import numpy.typing as npt
from shapely.geometry import MultiPoint, Point

from plano3d.application.ports import (
    DetectionRequest,
    DetectionResult,
    FloorPlanDetector,
    ImageQuality,
    ProgressPublisher,
)
from plano3d.domain import BuildingModel, Level, Scale, SourceImage, Wall
from plano3d.infrastructure.cv.context import Img, as_u8
from plano3d.infrastructure.cv.imageio import decode, encode_png
from plano3d.infrastructure.cv.stages.layout import Box, plan_blocks, prepare_sheet

#: lado mínimo (px) con que se detecta cada planta: las láminas suelen dibujar los muros
#: con líneas de 1 px, que hay que engrosar ampliando para que la detección las vea
MIN_PLAN_SIDE = 1000
MAX_UPSCALE = 4
#: altura de piso a piso de cada nivel apilado (muro de 2,6 m + losa)
FLOOR_TO_FLOOR_M = 2.8
#: búsqueda del desplazamiento entre plantas (px de la lámina)
ALIGN_RADIUS = 40
#: una planta con menos muros interiores que esto (relativo a su perímetro) es la azotea
ROOF_INTERIOR_RATIO = 0.6

Mat = npt.NDArray[np.float64]
log = logging.getLogger(__name__)


def _translation(dx: float, dy: float) -> Mat:
    return np.array([[1, 0, dx], [0, 1, dy], [0, 0, 1]], np.float64)


def _long_strokes(sheet: Img, box: Box) -> npt.NDArray[np.float32]:
    x0, y0, x1, y1 = box
    gray = cv2.cvtColor(sheet[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
    ink = (gray < 128).astype(np.uint8)
    k = max(8, min(gray.shape) // 25)
    h = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((1, k), np.uint8))
    v = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((k, 1), np.uint8))
    return cv2.dilate(cv2.bitwise_or(h, v), np.ones((3, 3), np.uint8)).astype(np.float32)


def align_offset(sheet: Img, ref: Box, other: Box, radius: int = ALIGN_RADIUS) -> tuple[int, int]:
    """Desplazamiento (dx, dy) que lleva coordenadas del recorte ``other`` al de ``ref``."""
    a, b = _long_strokes(sheet, ref), _long_strokes(sheet, other)
    h = max(a.shape[0], b.shape[0]) + 2 * radius
    w = max(a.shape[1], b.shape[1]) + 2 * radius
    padded = np.zeros((h, w), np.float32)
    padded[radius : radius + a.shape[0], radius : radius + a.shape[1]] = a
    res = cv2.matchTemplate(padded, b, cv2.TM_CCORR_NORMED)
    _, _, _, loc = cv2.minMaxLoc(res)
    return loc[0] - radius, loc[1] - radius


def _upscale(img: Img) -> tuple[Img, float]:
    side = max(img.shape[:2])
    f = float(min(MAX_UPSCALE, math.ceil(MIN_PLAN_SIDE / side))) if side < MIN_PLAN_SIDE else 1.0
    if f == 1.0:
        return img, 1.0
    # en láminas de baja resolución el muro es un par de líneas de 1 px a 1-2 px de
    # distancia: se cierra ese hueco ANTES de ampliar para que el muro quede macizo y
    # bien más grueso que los muebles, dibujados con una sola línea
    solid = cv2.morphologyEx(img, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return as_u8(cv2.resize(solid, None, fx=f, fy=f, interpolation=cv2.INTER_NEAREST)), f


def _scale_candidates(r: DetectionResult) -> list[float]:
    """m/px (de la imagen rectificada de esa planta) según cada método disponible."""
    keys = [k for k in ("mpp_walls", "mpp_doors") if k in r.metrics]
    return [r.metrics[k] for k in keys] or [r.model.scale.meters_per_pixel]


def _interior_ratio(level: Level) -> float:
    """Largo de tabiques por metro de perímetro (0 = solo el contorno)."""
    if not level.walls:
        return 0.0
    xs = [p for w in level.walls for p in (w.start.x, w.end.x)]
    ys = [p for w in level.walls for p in (w.start.y, w.end.y)]
    perimeter = 2 * ((max(xs) - min(xs)) + (max(ys) - min(ys)))
    total = sum(w.length for w in level.walls)
    return max(0.0, (total - perimeter) / perimeter) if perimeter > 0 else 0.0


def level_names(levels: list[Level]) -> list[str]:
    """Nombres por convención (izquierda→derecha = de abajo hacia arriba)."""
    n = len(levels)
    sparse = False
    # azotea: la última planta, casi sin tabiques o con muy pocos ambientes frente a la
    # anterior (antepechos y el volumen de la escalera)
    few_rooms = (
        n >= 2
        and len(levels[-2].rooms) >= 3
        and len(levels[-1].rooms) <= 0.3 * len(levels[-2].rooms)
    )
    if n >= 2:
        last, prev = _interior_ratio(levels[-1]), _interior_ratio(levels[-2])
        sparse = last < ROOF_INTERIOR_RATIO and last < 0.5 * prev
    roof = n >= 2 and (sparse or few_rooms)
    floors = n - 1 if roof else n
    names = ["Planta baja", "Planta alta"] if floors == 2 else ["Planta baja"]
    names += [f"Piso {k + 1}" for k in range(len(names), floors)]
    return [*names[:floors], *(["Azotea"] if roof else [])]


#: altura de los antepechos de una azotea
PARAPET_M = 1.1


def with_parapets(level: Level) -> Level:
    """En la azotea, el muro del borde (casco convexo de los muros) es un antepecho bajo; lo
    interior (volumen de la escalera, tanque) conserva su altura."""
    if not level.walls:
        return level
    pts = [(p.x, p.y) for w in level.walls if w.length >= 1.0 for p in (w.start, w.end)]
    if len(pts) < 3:
        return level
    edge = MultiPoint(pts).convex_hull.exterior

    def on_edge(w: Wall) -> bool:
        tol = w.thickness / 2 + 0.25
        mid = Point((w.start.x + w.end.x) / 2, (w.start.y + w.end.y) / 2)
        return (
            all(edge.distance(Point(p.x, p.y)) <= tol + 0.5 for p in (w.start, w.end))
            and edge.distance(mid) <= tol
        )

    walls = tuple(
        replace(w, height=PARAPET_M, openings=()) if on_edge(w) else w for w in level.walls
    )
    return replace(level, walls=walls)


class MultiLevelDetector(FloorPlanDetector):
    def __init__(self, inner: FloorPlanDetector) -> None:
        self._inner = inner
        # decorador transparente: se presenta como el detector que hace el trabajo
        self.name = inner.name

    def supports(self, quality: ImageQuality) -> bool:
        return self._inner.supports(quality)

    async def detect(
        self, request: DetectionRequest, progress: ProgressPublisher
    ) -> DetectionResult:
        if request.content_type == "application/pdf" or request.corners:
            return await self._inner.detect(request, progress)
        sheet = prepare_sheet(decode(request.image_bytes, request.content_type, max_side=10_000))
        blocks = plan_blocks(sheet)
        if len(blocks) < 2:
            return await self._inner.detect(request, progress)

        found = []
        used: list[Box] = []
        for box in blocks:
            x0, y0, x1, y1 = box
            crop, f = _upscale(sheet[y0:y1, x0:x1])
            sub = replace(
                request,
                image_bytes=encode_png(crop),
                content_type="image/png",
                corners=None,
                scale_hint=None,
            )
            try:
                r = await self._inner.detect(sub, progress)
            except Exception as exc:  # una planta ilegible no tumba las demás
                log.warning("Planta %s descartada: %s", box, exc)
                continue
            h = np.array(r.image_transform or np.eye(3).ravel(), np.float64).reshape(3, 3)
            sheet_to_rect = h @ np.diag([f, f, 1.0]) @ _translation(-x0, -y0)
            s = math.sqrt(abs(np.linalg.det(sheet_to_rect[:2, :2])))
            found.append((box, r, sheet_to_rect, s))
            used.append(box)
        if not found:
            return await self._inner.detect(request, progress)
        blocks = used

        # escala común (m por px de lámina). Si alguna planta trae cotas, manda; si no, la
        # mediana de todas las estimaciones (grosor de muros y puertas de cada planta): es
        # una sola lámina, y un método engañado en una planta no arrastra al resto
        best = max(found, key=lambda t: t[1].model.scale.confidence)
        if best[1].model.scale.source in ("dimensions", "calibrated", "vector"):
            m = best[1].model.scale.meters_per_pixel * best[3]
        else:
            m = float(np.median([v * s for _, r, _, s in found for v in _scale_candidates(r)]))
        x00, y00 = blocks[0][0], blocks[0][1]
        levels: list[Level] = []
        transforms: list[tuple[float, ...]] = []
        for k, (box, r, sheet_to_rect, s) in enumerate(found):
            dx, dy = align_offset(sheet, blocks[0], box) if k else (0, 0)
            # lámina → marco común: recorte de la planta 0, corrido según la alineación
            to_common = _translation(-box[0] + dx, -box[1] + dy)
            origin = np.linalg.inv(sheet_to_rect) @ np.array([0.0, 0.0, 1.0])
            ox, oy = (to_common @ (origin / origin[2]))[:2]
            factor = m / (r.model.scale.meters_per_pixel * s)
            for lv in r.model.levels:
                levels.append(lv.scaled(factor).translated(ox * m, oy * m))
                transforms.append(tuple(float(v) for v in to_common.ravel()))

        names = level_names(levels)
        stacked = tuple(
            replace(
                with_parapets(lv) if names[k] == "Azotea" else lv,
                id=f"lvl_{k}",
                name=names[k],
                elevation=round(k * FLOOR_TO_FLOOR_M, 3),
                height=FLOOR_TO_FLOOR_M,
            )
            for k, lv in enumerate(levels)
        )
        model = BuildingModel(
            project_id=request.project_id,
            scale=Scale(m, best[1].model.scale.source, best[1].model.scale.confidence),
            levels=stacked,
            source_image=SourceImage("", blocks[0][2] - x00, blocks[0][3] - y00),
        )
        x0, y0, x1, y1 = blocks[0]
        metrics = {**best[1].metrics, "levels": float(len(stacked))}
        return DetectionResult(
            model=model,
            rectified_png=encode_png(sheet[y0:y1, x0:x1]),
            metrics=metrics,
            image_transform=tuple(float(v) for v in _translation(-x00, -y00).ravel()),
            level_transforms=tuple(transforms),
        )

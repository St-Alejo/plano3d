"""Segmentación de habitaciones sobre la máscara raster.

Se dibujan los muros vectorizados COMPLETOS (con las aberturas cerradas) para
que las habitaciones no se "fuguen" por las puertas; el espacio libre que no
toca el borde de la imagen es interior, y cada componente conexa es un ambiente.
"""

from __future__ import annotations

import cv2
import numpy as np
import numpy.typing as npt

from plano3d.application.pipeline import PipelineStage
from plano3d.infrastructure.cv.context import CVContext, Img, PxRoom, Segment, as_u8
from plano3d.infrastructure.cv.stages.walls import draw_segment

MIN_ROOM_M2 = 1.0
#: más angosto que esto no es un ambiente (el hueco entre un sofá y el muro, un ducto)
MIN_ROOM_WIDTH_M = 0.6


def closed_wall_mask(shape: tuple[int, int], segments: list[Segment], raw: Img | None) -> Img:
    mask = np.zeros(shape, np.uint8)
    for s in segments:
        draw_segment(mask, s, extend=True)
    if raw is not None:
        mask = as_u8(cv2.bitwise_or(mask, raw))
    # los pasos (vanos sin hoja) comunican: no separan ambientes
    for s in segments:
        dx, dy = s.direction
        for o in s.openings:
            if o.operation != "none":
                continue
            a0, a1 = o.offset + s.thickness / 2, o.offset + o.width - s.thickness / 2
            span = Segment(
                s.x1 + dx * a0, s.y1 + dy * a0, s.x1 + dx * a1, s.y1 + dy * a1, s.thickness + 4
            )
            if a1 > a0:
                draw_segment(mask, span, extend=False, value=0)
    return mask


def find_rooms(
    walls: Img, min_area_px: float, simplify_px: float, min_width_px: float = 0.0
) -> list[tuple[npt.NDArray[np.float64], float]]:
    free = cv2.bitwise_not(walls)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(free, connectivity=4)
    h, w = walls.shape
    border = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])))
    rooms: list[tuple[npt.NDArray[np.float64], float]] = []
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        if i in border or area < min_area_px or area > 0.9 * h * w:
            continue
        comp = (labels == i).astype(np.uint8) * 255
        if min_width_px and 2 * cv2.distanceTransform(comp, cv2.DIST_L2, 3).max() < min_width_px:
            continue
        contours, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        c = max(contours, key=cv2.contourArea)
        poly = cv2.approxPolyDP(c, simplify_px, True).reshape(-1, 2).astype(np.float64)
        if len(poly) < 3:
            continue
        hull_area = cv2.contourArea(cv2.convexHull(c))
        solidity = float(cv2.contourArea(c) / hull_area) if hull_area else 0.0
        complexity_penalty = max(0.0, (len(poly) - 8) * 0.03)
        confidence = float(np.clip(0.35 + 0.6 * solidity - complexity_penalty, 0.1, 0.95))
        rooms.append((poly, confidence))
    # orden de lectura: arriba→abajo, izquierda→derecha
    rooms.sort(key=lambda r: (round(r[0][:, 1].mean() / 50), r[0][:, 0].mean()))
    return rooms


class RoomsStage(PipelineStage[CVContext]):
    key = "rooms"
    title = "Segmentación de habitaciones"

    def run(self, ctx: CVContext) -> CVContext:
        img = ctx.require(ctx.rectified, "rectified")
        walls = closed_wall_mask(img.shape[:2], ctx.segments, ctx.wall_mask)
        min_px = MIN_ROOM_M2 / (ctx.meters_per_pixel**2)
        found = find_rooms(
            walls,
            min_px,
            max(1.5, ctx.wall_thickness_px * 0.3),
            MIN_ROOM_WIDTH_M / ctx.meters_per_pixel,
        )
        ctx.rooms = [PxRoom(poly, conf, f"Espacio {i + 1}") for i, (poly, conf) in enumerate(found)]
        return ctx

    def metrics(self, ctx: CVContext) -> dict[str, float]:
        conf = [r.confidence for r in ctx.rooms]
        return {
            "room_count": len(ctx.rooms),
            "mean_confidence": round(float(np.mean(conf)), 3) if conf else 0.0,
        }

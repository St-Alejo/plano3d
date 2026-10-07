"""Textos de la hoja: se leen una vez (TextSpotStage) y sirven para descartar letras como
evidencia de puertas y para nombrar ambientes (RoomNamesStage)."""

from __future__ import annotations

import cv2
import numpy as np

from plano3d.application.pipeline import PipelineStage
from plano3d.application.ports import SpottedText, TextSpotter
from plano3d.domain.plan_text import room_name_from_texts
from plano3d.infrastructure.cv.context import CVContext, Img, PxRoom


def name_rooms(rooms: list[PxRoom], texts: list[SpottedText]) -> list[PxRoom]:
    """Asigna a cada ambiente el nombre de los textos cuyo centro está dentro.

    Los textos se pasan en orden de lectura (arriba→abajo, izquierda→derecha) para que en
    un espacio abierto "COCINA … SALA" se nombre en el orden del plano. Un ambiente sin
    texto reconocible conserva su nombre genérico.
    """
    ordered = sorted(texts, key=lambda t: (round(t.y / max(t.height, 1.0)), t.x))
    out: list[PxRoom] = []
    for room in rooms:
        contour = room.polygon.astype(np.float32).reshape(-1, 1, 2)
        inside = [t.text for t in ordered if cv2.pointPolygonTest(contour, (t.x, t.y), False) >= 0]
        found = room_name_from_texts(inside)
        out.append(PxRoom(room.polygon, room.confidence, found.label) if found else room)
    return out


def text_mask(shape: tuple[int, ...], texts: list[SpottedText], pad: float = 2.0) -> Img:
    """255 donde hay texto leído (cajas con un pequeño margen)."""
    mask = np.zeros(shape[:2], np.uint8)
    for t in texts:
        if t.width <= 0:
            continue
        x0, x1 = round(t.x - t.width / 2 - pad), round(t.x + t.width / 2 + pad)
        y0, y1 = round(t.y - t.height / 2 - pad), round(t.y + t.height / 2 + pad)
        cv2.rectangle(mask, (x0, y0), (x1, y1), 255, -1)
    return mask


class TextSpotStage(PipelineStage[CVContext]):
    key = "texts"
    title = "Lectura de textos"

    def __init__(self, spotter: TextSpotter | None) -> None:
        self._spotter = spotter

    def run(self, ctx: CVContext) -> CVContext:
        if self._spotter is not None:
            ctx.texts = self._spotter.spot(ctx.require(ctx.rectified, "rectified"))
        return ctx

    def metrics(self, ctx: CVContext) -> dict[str, float]:
        return {"text_count": float(len(ctx.texts))}


class RoomNamesStage(PipelineStage[CVContext]):
    key = "room_names"
    title = "Lectura de nombres de ambientes"

    def __init__(self) -> None:
        self._named = 0

    def run(self, ctx: CVContext) -> CVContext:
        if not ctx.texts or not ctx.rooms:
            return ctx
        before = [r.label for r in ctx.rooms]
        ctx.rooms = name_rooms(ctx.rooms, ctx.texts)
        self._named = sum(a != b.label for a, b in zip(before, ctx.rooms, strict=True))
        return ctx

    def metrics(self, ctx: CVContext) -> dict[str, float]:
        return {"named_rooms": float(self._named)}

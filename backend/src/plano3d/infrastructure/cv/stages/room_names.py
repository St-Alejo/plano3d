"""Nombres de ambientes: los textos de la hoja que caen dentro de cada polígono."""

from __future__ import annotations

import cv2
import numpy as np

from plano3d.application.pipeline import PipelineStage
from plano3d.application.ports import SpottedText, TextSpotter
from plano3d.domain.plan_text import room_name_from_texts
from plano3d.infrastructure.cv.context import CVContext, PxRoom


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


class RoomNamesStage(PipelineStage[CVContext]):
    key = "room_names"
    title = "Lectura de nombres de ambientes"

    def __init__(self, spotter: TextSpotter | None) -> None:
        self._spotter = spotter
        self._named = 0

    def run(self, ctx: CVContext) -> CVContext:
        if self._spotter is None or not ctx.rooms:
            return ctx
        img = ctx.require(ctx.rectified, "rectified")
        before = [r.label for r in ctx.rooms]
        ctx.rooms = name_rooms(ctx.rooms, self._spotter.spot(img))
        self._named = sum(a != b.label for a, b in zip(before, ctx.rooms, strict=True))
        return ctx

    def metrics(self, ctx: CVContext) -> dict[str, float]:
        return {"named_rooms": float(self._named)}

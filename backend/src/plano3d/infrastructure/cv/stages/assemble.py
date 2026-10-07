"""Ensamblado: píxeles → metros → BuildingModel del dominio."""

from __future__ import annotations

import logging

from shapely.geometry import Polygon

from plano3d.application.pipeline import PipelineStage
from plano3d.domain import (
    BuildingModel,
    Level,
    Opening,
    OpeningKind,
    OpeningOperation,
    Point2D,
    Room,
    Scale,
    SourceImage,
    Wall,
    new_id,
)
from plano3d.domain.building import MAX_ROOM_OVERLAP_RATIO
from plano3d.domain.errors import DomainError
from plano3d.domain.plan_text import room_type_from_name
from plano3d.infrastructure.cv.context import CVContext, PxRoom, Segment

log = logging.getLogger(__name__)

WALL_HEIGHT = 2.6
DOOR_HEIGHT = 2.1
WINDOW_SILL = 0.9
WINDOW_HEIGHT = 1.2


def _wall(s: Segment, mpp: float) -> Wall | None:
    openings = []
    for op in s.openings:
        is_door = op.kind == "door"
        openings.append(
            Opening(
                id=new_id("op"),
                kind=OpeningKind.DOOR if is_door else OpeningKind.WINDOW,
                offset=op.offset * mpp,
                width=op.width * mpp,
                height=DOOR_HEIGHT if is_door else WINDOW_HEIGHT,
                sill=0.0 if is_door else WINDOW_SILL,
                confidence=round(op.confidence, 3),
                operation=OpeningOperation(op.operation) if op.operation else None,
            )
        )
    try:
        return Wall(
            id=new_id("w"),
            start=Point2D(s.x1 * mpp, s.y1 * mpp),
            end=Point2D(s.x2 * mpp, s.y2 * mpp),
            thickness=s.thickness * mpp,
            height=WALL_HEIGHT,
            openings=tuple(openings),
            confidence=round(s.confidence, 3),
        )
    except DomainError as exc:
        log.warning("Muro descartado: %s", exc)
        return None


def _room(r: PxRoom, mpp: float) -> Room | None:
    shape = Polygon(r.polygon * mpp)
    if not shape.is_valid:
        fixed = shape.buffer(0)
        if fixed.geom_type == "MultiPolygon":
            fixed = max(fixed.geoms, key=lambda g: g.area)
        shape = fixed
    if shape.is_empty or shape.geom_type != "Polygon":
        return None
    coords = list(shape.exterior.coords)[:-1]
    try:
        return Room(
            id=new_id("r"),
            label=r.label,
            polygon=tuple(Point2D(float(x), float(y)) for x, y in coords),
            confidence=round(r.confidence, 3),
            room_type=room_type_from_name(r.label),
        )
    except DomainError as exc:
        log.warning("Habitación descartada: %s", exc)
        return None


def _without_overlaps(rooms: list[Room]) -> list[Room]:
    """Quita los ambientes que se solapan con otro mayor (una isla cerrada dentro de un
    ambiente: bloque de escalera, mueble macizo). Antes un solo solape tumbaba todos."""
    kept: list[Room] = []
    for r in sorted(rooms, key=lambda r: -r.as_shapely().area):
        a = r.as_shapely()
        if all(
            a.intersection(k.as_shapely()).area <= MAX_ROOM_OVERLAP_RATIO * a.area for k in kept
        ):
            kept.append(r)
        else:
            log.info("Ambiente %s descartado: está dentro de otro", r.label)
    order = {r.id: i for i, r in enumerate(rooms)}
    return sorted(kept, key=lambda r: order[r.id])


def build_model(ctx: CVContext) -> BuildingModel:
    mpp = ctx.meters_per_pixel
    walls = [w for s in ctx.segments if (w := _wall(s, mpp)) is not None]
    rooms = _without_overlaps([r for pr in ctx.rooms if (r := _room(pr, mpp)) is not None])
    img = ctx.rectified
    try:
        level = Level(id="lvl_0", name="Planta baja", walls=tuple(walls), rooms=tuple(rooms))
    except DomainError as exc:  # p. ej. habitaciones solapadas: se conservan solo los muros
        log.warning("Habitaciones descartadas: %s", exc)
        level = Level(id="lvl_0", name="Planta baja", walls=tuple(walls))
    return BuildingModel(
        project_id=ctx.project_id,
        scale=Scale(mpp, "estimated", ctx.scale_confidence),
        levels=(level,),
        source_image=SourceImage("", img.shape[1], img.shape[0]) if img is not None else None,
    )


class AssembleStage(PipelineStage[CVContext]):
    key = "assemble"
    title = "Ensamblado del modelo"

    def run(self, ctx: CVContext) -> CVContext:
        ctx.model = build_model(ctx)
        return ctx

    def metrics(self, ctx: CVContext) -> dict[str, float]:
        m = ctx.require(ctx.model, "model")
        return {"total_area_m2": round(m.total_area, 2)}

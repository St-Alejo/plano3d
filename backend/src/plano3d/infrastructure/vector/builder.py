"""Etapas del importador vectorial: Drawing → muros → ambientes → BuildingModel v2.

Mismo patrón Pipeline que la visión clásica, así la interfaz muestra el progreso igual.
Las medidas salen EXACTAS (fuente "vector") cuando el archivo trae su escala real.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field, replace

import cv2
import numpy as np
from shapely.geometry import Point, Polygon

from plano3d.application.pipeline import PipelineStage
from plano3d.domain import (
    BuildingModel,
    Column,
    Dimension,
    DimensionAxis,
    LabelKind,
    Level,
    Measure,
    MeasureSource,
    MeasureStatus,
    Opening,
    OpeningKind,
    OpeningOperation,
    Point2D,
    Room,
    RoomType,
    Scale,
    SourceImage,
    Stair,
    TextLabel,
    Wall,
    WallKind,
    new_id,
)
from plano3d.domain.building import ScaleSource
from plano3d.domain.errors import DomainError
from plano3d.domain.plan_text import (
    classify_label,
    parse_area,
    parse_level,
    parse_scale,
    room_type_from_name,
    strip_accents,
)
from plano3d.infrastructure.vector.primitives import Drawing, LayerRole, layer_role
from plano3d.infrastructure.vector.walls import (
    CAD,
    T_MAX,
    T_MIN,
    ColumnCand,
    OpeningCand,
    StairCand,
    Tol,
    WallCand,
    _Evidence,
    chain_walls,
    columns_from_closed,
    connected_only,
    exterior_walls,
    find_stairs,
    object_rectangles,
    pair_arcs,
    pair_lines,
    rooms_from_walls,
    snap,
)

MARGIN_M = 1.0
MAX_PREVIEW_PX = 2400
WALL_HEIGHT = 2.6
DOOR_HEIGHT = 2.1
WINDOW_SILL = 0.9
WINDOW_HEIGHT = 1.2


@dataclass
class VectorContext:
    project_id: str
    data: bytes
    reader: Callable[[bytes], Drawing]
    source: MeasureSource = MeasureSource.VECTOR
    tol: Tol = CAD
    #: espesores de muro admisibles (m); en fotos el mínimo depende del ancho de trazo
    t_min: float = T_MIN
    t_max: float = T_MAX
    drawing: Drawing | None = None
    stairs: list[StairCand] = field(default_factory=list)
    walls: list[WallCand] = field(default_factory=list)
    rooms: list[Polygon] = field(default_factory=list)
    columns: list[ColumnCand] = field(default_factory=list)
    model: BuildingModel | None = None
    preview: np.ndarray | None = None
    mpp: float = 0.01
    metrics: dict[str, float] = field(default_factory=dict)
    #: escala cuando el dibujo NO es exacto (fotos): de dónde salió y cuánto confiar
    scale_source: ScaleSource = "estimated"
    scale_confidence: float = 0.4
    #: incertidumbre de una longitud inferida (m) = abs + rel * largo
    error_abs: float = 0.05
    error_rel: float = 0.0

    def require[T](self, value: T | None, name: str) -> T:
        if value is None:
            raise RuntimeError(f"Falta '{name}': ¿se ejecutó la etapa anterior?")
        return value


class ReadStage(PipelineStage[VectorContext]):
    key = "read"
    title = "Lectura del archivo vectorial"

    def run(self, ctx: VectorContext) -> VectorContext:
        d = ctx.reader(ctx.data)
        if not d.lines and not d.arcs:
            raise ValueError("El archivo no tiene líneas que puedan ser muros")
        x0, y0, _, _ = d.bounds()
        ctx.drawing = d.moved(MARGIN_M - x0, MARGIN_M - y0)
        return ctx

    def metrics(self, ctx: VectorContext) -> dict[str, float]:
        d = ctx.require(ctx.drawing, "drawing")
        return {"lines": float(len(d.lines)), "texts": float(len(d.texts))}


class WallsStage(PipelineStage[VectorContext]):
    key = "walls"
    title = "Muros desde las caras dibujadas"

    def run(self, ctx: VectorContext) -> VectorContext:
        d = ctx.require(ctx.drawing, "drawing")
        objects = object_rectangles(d.lines, ctx.tol)
        lines = [ln for i, ln in enumerate(d.lines) if i not in objects]
        stairs, stair_lines = find_stairs(lines, ctx.tol)
        rest = [ln for i, ln in enumerate(lines) if i not in stair_lines]
        wall_lines = [ln for ln in rest if layer_role(ln.layer) is not LayerRole.STAIR]
        pieces, used_lines = pair_lines(wall_lines, ctx.t_min, ctx.t_max, tol=ctx.tol)
        curved, used_arcs = pair_arcs(d.arcs, ctx.t_min, ctx.t_max, tol=ctx.tol)
        evidence = _Evidence(
            [*d.detail_lines, *(ln for i, ln in enumerate(wall_lines) if i not in used_lines)],
            [*d.detail_arcs, *(a for i, a in enumerate(d.arcs) if i not in used_arcs)],
            d.inserts,
        )
        walls = chain_walls([*pieces, *curved], evidence, ctx.tol)
        walls = connected_only(snap(walls, ctx.tol.snap))
        ctx.walls = walls
        ctx.stairs = stairs
        ctx.columns = columns_from_closed(
            [c for c in d.closed if c.filled or layer_role(c.layer) is LayerRole.COLUMN],
            column_layer=True,
        )
        return ctx

    def metrics(self, ctx: VectorContext) -> dict[str, float]:
        return {
            "walls": float(len(ctx.walls)),
            "curved_walls": float(sum(w.curved for w in ctx.walls)),
            "openings": float(sum(len(w.openings) for w in ctx.walls)),
        }


class RoomsStage(PipelineStage[VectorContext]):
    key = "rooms"
    title = "Ambientes"

    def run(self, ctx: VectorContext) -> VectorContext:
        ctx.rooms = rooms_from_walls(ctx.walls)
        return ctx

    def metrics(self, ctx: VectorContext) -> dict[str, float]:
        return {"rooms": float(len(ctx.rooms))}


class AssembleStage(PipelineStage[VectorContext]):
    key = "assemble"
    title = "Ensamblado del modelo"

    def run(self, ctx: VectorContext) -> VectorContext:
        d = ctx.require(ctx.drawing, "drawing")
        _, _, x1, y1 = d.bounds()
        width_m, height_m = x1 + MARGIN_M, y1 + MARGIN_M
        ctx.mpp = max(0.005, max(width_m, height_m) / MAX_PREVIEW_PX)
        ctx.preview = render_preview(d, ctx.mpp, width_m, height_m)
        ctx.model = assemble_model(ctx, d)
        return ctx

    def metrics(self, ctx: VectorContext) -> dict[str, float]:
        m = ctx.require(ctx.model, "model")
        return {"total_area_m2": round(m.total_area, 2)}


def vector_stages() -> list[PipelineStage[VectorContext]]:
    return [ReadStage(), WallsStage(), RoomsStage(), AssembleStage()]


# ----------------------------------------------------------------------------- modelo


def _opening(o: OpeningCand, wall_len: float) -> Opening | None:
    is_door = o.kind == "door"
    if o.offset < 0 or o.offset + o.width > wall_len + 1e-6:
        return None
    op = None
    if o.operation:
        op = OpeningOperation(o.operation)
    elif not is_door:
        op = OpeningOperation.CASEMENT
    return Opening(
        id=new_id("op"),
        kind=OpeningKind.DOOR if is_door else OpeningKind.WINDOW,
        offset=o.offset,
        width=o.width,
        height=DOOR_HEIGHT if is_door else WINDOW_HEIGHT,
        sill=0.0 if is_door else WINDOW_SILL,
        confidence=round(min(1.0, o.confidence), 3),
        operation=op,
        hinge_at_end=o.hinge_at_end,
        opens_left=o.opens_left,
    )


def assemble_model(ctx: VectorContext, d: Drawing) -> BuildingModel:
    exact = d.exact_scale

    def measure_for(length: float) -> Measure:
        if exact:
            return Measure(MeasureStatus.EXACT, ctx.source, 0.001)
        err = ctx.error_abs + ctx.error_rel * length
        return Measure(MeasureStatus.INFERRED, MeasureSource.SCALE, round(err, 4))

    outer = exterior_walls(ctx.walls)
    walls: list[Wall] = []
    for i, w in enumerate(ctx.walls):
        kind = (
            WallKind.EXTERIOR
            if i in outer
            else (WallKind.PARTITION if w.thickness <= 0.11 else WallKind.INTERIOR)
        )
        base = dict(
            id=new_id("w"),
            start=Point2D(w.x1, w.y1),
            end=Point2D(w.x2, w.y2),
            thickness=w.thickness,
            height=WALL_HEIGHT,
            bulge=w.bulge,
            kind=kind,
            structural=kind is WallKind.EXTERIOR and w.thickness >= 0.2,
            measure=measure_for(math.hypot(w.x2 - w.x1, w.y2 - w.y1)),
            confidence=round(w.confidence, 3),
        )
        try:
            probe = Wall(**base)  # type: ignore[arg-type]
        except DomainError:
            continue
        ops = [op for o in w.openings if (op := _opening(o, probe.length)) is not None]
        ops.sort(key=lambda o: o.offset)
        clean: list[Opening] = []
        for op in ops:
            if clean and op.offset < clean[-1].end:
                continue
            clean.append(op)
        try:
            walls.append(Wall(**base, openings=tuple(clean)))  # type: ignore[arg-type]
        except DomainError:
            walls.append(probe)

    # textos: nombres y áreas de ambientes, niveles, escala
    consumed: set[int] = set()
    rooms: list[Room] = []
    for k, poly in enumerate(ctx.rooms):
        inside = [
            (i, t)
            for i, t in enumerate(d.texts)
            if i not in consumed and poly.contains(Point(t.x, t.y))
        ]
        name = next(
            ((i, t) for i, t in inside if classify_label(t.text) is LabelKind.ROOM_NAME), None
        )
        area = next(((i, t) for i, t in inside if parse_area(t.text) is not None), None)
        label = name[1].text if name else f"Espacio {k + 1}"
        for hit in (name, area):
            if hit:
                consumed.add(hit[0])
        coords = list(poly.exterior.coords)[:-1]
        try:
            rooms.append(
                Room(
                    id=new_id("r"),
                    label=label,
                    polygon=tuple(Point2D(float(x), float(y)) for x, y in coords),
                    confidence=0.95,
                    room_type=room_type_from_name(label) if name else RoomType.OTHER,
                    declared_area=parse_area(area[1].text) if area else None,
                )
            )
        except DomainError:
            continue

    labels: list[TextLabel] = []
    elevation = 0.0
    scale_den: int | None = None
    for i, t in enumerate(d.texts):
        if i in consumed:
            continue
        label_kind = classify_label(t.text)
        if label_kind is LabelKind.LEVEL and not labels_have_level(labels):
            elevation = parse_level(t.text) or 0.0
        if label_kind is LabelKind.SCALE:
            scale_den = parse_scale(t.text)
        try:
            labels.append(
                TextLabel(new_id("t"), Point2D(t.x, t.y), t.text, label_kind, t.rotation, 0.99)
            )
        except DomainError:
            continue
    if scale_den:
        ctx.metrics["scale_denominator"] = float(scale_den)

    dims: list[Dimension] = []
    for dp in d.dims:
        axis = DimensionAxis(dp.axis)
        try:
            dim = Dimension(
                id=new_id("d"),
                a=Point2D(*dp.a),
                b=Point2D(*dp.b),
                value=dp.value,
                text=strip_accents(dp.text) if dp.text else "",
                axis=axis,
                offset=dp.offset,
                source=ctx.source,
                status=MeasureStatus.EXACT if exact else MeasureStatus.INFERRED,
                confidence=1.0 if exact else round(min(1.0, max(0.05, dp.confidence)), 3),
            )
            dims.append(replace(dim, residual=dim.deviation))
        except DomainError:
            continue

    columns = []
    for c in ctx.columns:
        try:
            columns.append(
                Column(
                    new_id("c"),
                    Point2D(*c.center),
                    c.width,
                    c.depth,
                    c.round,
                    c.rotation,
                    0.95,
                )
            )
        except DomainError:
            continue
    stairs = []
    for s in ctx.stairs:
        try:
            stairs.append(Stair(new_id("s"), Point2D(*s.start), Point2D(*s.end), s.width, s.steps))
        except DomainError:
            continue

    level = Level(
        id="lvl_0",
        name="Planta 1",
        elevation=elevation,
        walls=tuple(walls),
        rooms=tuple(rooms),
        height=WALL_HEIGHT,
        columns=tuple(columns),
        stairs=tuple(stairs),
        dimensions=tuple(dims),
        labels=tuple(labels),
    )
    preview = ctx.require(ctx.preview, "preview")
    return BuildingModel(
        project_id=ctx.project_id,
        scale=Scale(
            ctx.mpp,
            "vector" if exact else ctx.scale_source,
            1.0 if exact else ctx.scale_confidence,
        ),
        levels=(level,),
        source_image=SourceImage("", int(preview.shape[1]), int(preview.shape[0])),
    )


def labels_have_level(labels: list[TextLabel]) -> bool:
    return any(lb.kind is LabelKind.LEVEL for lb in labels)


# ----------------------------------------------------------------------------- vista


def render_preview(d: Drawing, mpp: float, width_m: float, height_m: float) -> np.ndarray:
    """Imagen del dibujo (fondo del editor 2D): 1 px = ``mpp`` metros, origen en (0, 0)."""
    w = max(1, math.ceil(width_m / mpp))
    h = max(1, math.ceil(height_m / mpp))
    img = np.full((h, w, 3), 255, np.uint8)
    ink = (40, 40, 40)
    soft = (140, 140, 140)

    def px(p: tuple[float, float]) -> tuple[int, int]:
        return round(p[0] / mpp), round(p[1] / mpp)

    for ln in d.lines:
        cv2.line(img, px(ln.p1), px(ln.p2), ink, 1, cv2.LINE_AA)
    for ln in d.detail_lines:
        cv2.line(img, px(ln.p1), px(ln.p2), soft, 1, cv2.LINE_AA)
    for arc in (*d.arcs, *d.detail_arcs):
        pts = np.array([px(p) for p in arc.polyline(max(mpp * 2, 0.02))], np.int32)
        cv2.polylines(img, [pts], False, soft if arc in d.detail_arcs else ink, 1, cv2.LINE_AA)
    for cl in d.closed:
        pts = np.array([px(p) for p in cl.points], np.int32)
        if cl.filled:
            cv2.fillPoly(img, [pts], ink)
        else:
            cv2.polylines(img, [pts], True, ink, 1, cv2.LINE_AA)
    for t in d.texts:
        size = max(0.3, (t.height or 0.2) / mpp / 30)
        text = strip_accents(t.text).encode("ascii", "replace").decode()
        cv2.putText(img, text, px((t.x, t.y)), cv2.FONT_HERSHEY_SIMPLEX, size, soft, 1)
    return img

"""DTOs (Pydantic): contrato público entre backend y frontend.

Se exportan a OpenAPI y el frontend genera sus tipos TypeScript desde ahí
(`npm run gen:api`), de modo que el esquema de BuildingModel tiene una sola definición.
Los campos derivados (``length``, ``area``, ``centroid``) son de solo salida: al
recibir un modelo se ignoran y el dominio los vuelve a calcular.

Modelo v2 (ADR-012): los campos nuevos son OPCIONALES en el contrato (``None`` = valor por
defecto del dominio). Así un modelo v1 guardado en la base, o enviado por un cliente
anterior, sigue siendo válido, y al volver a guardarse queda en v2.
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from plano3d.domain import (
    MODEL_SCHEMA_VERSION,
    BuildingModel,
    Column,
    Dimension,
    DimensionAxis,
    Furniture,
    LabelKind,
    Level,
    Measure,
    MeasureSource,
    MeasureStatus,
    ModelRevision,
    Opening,
    OpeningKind,
    OpeningOperation,
    Point2D,
    Project,
    ProjectStatus,
    Room,
    RoomType,
    Scale,
    SourceImage,
    Stair,
    TextLabel,
    Wall,
    WallKind,
)
from plano3d.domain.quality import CorrectionStats


class _DTO(BaseModel):
    model_config = ConfigDict(extra="ignore")


class PointDTO(_DTO):
    x: float
    y: float


class OpeningDTO(_DTO):
    id: str
    kind: OpeningKind
    offset: float = Field(description="metros desde Wall.start")
    width: float
    height: float
    sill: float = 0.0
    confidence: float = 1.0
    operation: OpeningOperation | None = None
    hinge_at_end: bool | None = None
    opens_left: bool | None = None


class MeasureDTO(_DTO):
    """Procedencia de una longitud: exacta (cota o vector), inferida (escala) o en conflicto."""

    status: MeasureStatus = MeasureStatus.INFERRED
    source: MeasureSource = MeasureSource.SCALE
    error: float = Field(0.0, description="incertidumbre ± en metros")
    dimension_id: str | None = None


class WallDTO(_DTO):
    id: str
    start: PointDTO
    end: PointDTO
    thickness: float = 0.15
    height: float = 2.6
    material: str = "plaster"
    openings: list[OpeningDTO] = []
    confidence: float = 1.0
    length: float | None = Field(default=None, description="solo salida")
    bulge: float | None = Field(
        default=None, description="flecha del arco en m (0 o null = recto); + hacia (-dy, dx)"
    )
    kind: WallKind | None = None
    structural: bool | None = None
    measure: MeasureDTO | None = None


class RoomDTO(_DTO):
    id: str
    label: str
    polygon: list[PointDTO]
    confidence: float = 1.0
    area: float | None = Field(default=None, description="solo salida, m²")
    centroid: PointDTO | None = Field(default=None, description="solo salida")
    room_type: RoomType | None = None
    holes: list[list[PointDTO]] | None = None
    declared_area: float | None = Field(default=None, description="área escrita en el plano")
    floor_material: str | None = Field(
        default=None, description="acabado de piso (null = según el tipo)"
    )


class ColumnDTO(_DTO):
    id: str
    center: PointDTO
    width: float = 0.3
    depth: float = 0.3
    round: bool = False
    rotation: float = 0.0
    confidence: float = 1.0


class FurnitureDTO(_DTO):
    """Mueble del catálogo (ADR-016): el cliente arma la geometría desde ``catalog_id``."""

    id: str
    catalog_id: str
    position: PointDTO = Field(description="centro de la huella, m")
    width: float
    depth: float
    height: float
    rotation: float = Field(default=0.0, description="radianes")


class StairDTO(_DTO):
    id: str
    start: PointDTO = Field(description="arranque (abajo) de la línea de huella")
    end: PointDTO = Field(description="llegada (arriba)")
    width: float
    steps: int
    riser: float = 0.175
    to_level_id: str | None = None
    confidence: float = 1.0
    tread: float | None = Field(default=None, description="solo salida, huella en m")
    base: float = Field(default=0.0, description="altura de arranque del tramo sobre el piso, m")


class DimensionDTO(_DTO):
    id: str
    a: PointDTO
    b: PointDTO
    value: float = Field(description="valor escrito en el plano, m")
    text: str = ""
    axis: DimensionAxis = DimensionAxis.ALIGNED
    offset: float = 0.0
    source: MeasureSource = MeasureSource.DIMENSION
    status: MeasureStatus = MeasureStatus.INFERRED
    confidence: float = 1.0
    residual: float | None = None
    wall_ids: list[str] = []
    measured: float | None = Field(default=None, description="solo salida, m")


class TextLabelDTO(_DTO):
    id: str
    position: PointDTO
    text: str
    kind: LabelKind = LabelKind.OTHER
    rotation: float = 0.0
    confidence: float = 1.0


class LevelDTO(_DTO):
    id: str
    name: str
    elevation: float = 0.0
    walls: list[WallDTO] = []
    rooms: list[RoomDTO] = []
    height: float | None = Field(default=None, description="entrepiso en m (null = 2,6)")
    columns: list[ColumnDTO] | None = None
    stairs: list[StairDTO] | None = None
    dimensions: list[DimensionDTO] | None = None
    labels: list[TextLabelDTO] | None = None
    furniture: list[FurnitureDTO] | None = None


class ScaleDTO(_DTO):
    meters_per_pixel: float
    source: Literal["default", "estimated", "calibrated", "dimensions", "vector"] = "estimated"
    confidence: float = 0.5


class SourceImageDTO(_DTO):
    key: str
    width_px: int
    height_px: int


class BuildingModelDTO(_DTO):
    project_id: str
    scale: ScaleDTO
    levels: list[LevelDTO] = []
    source_image: SourceImageDTO | None = None
    total_area: float | None = Field(default=None, description="solo salida, m²")
    schema_version: int | None = Field(default=None, description="null = 1 (se actualiza a 2)")


class ProjectSummaryDTO(_DTO):
    id: str
    name: str
    status: ProjectStatus
    error: str | None = None
    created_at: datetime
    updated_at: datetime
    total_area: float | None = None
    room_count: int = 0


class ProjectDTO(ProjectSummaryDTO):
    model: BuildingModelDTO | None = None
    revision: int = Field(0, description="versión del modelo; enviarla en If-Match al guardar")


class RevisionDTO(_DTO):
    number: int
    summary: str
    created_at: datetime
    total_area: float
    wall_count: int


class CorrectionStatsDTO(_DTO):
    walls_detected: int
    walls_final: int
    walls_unchanged: int
    walls_moved: int
    walls_added: int
    walls_deleted: int
    openings_added: int
    openings_deleted: int
    openings_kind_changed: int
    rooms_relabeled: int
    area_detected_m2: float
    area_final_m2: float
    correction_rate: float = Field(description="fracción de muros detectados que se corrigieron")


class SolveReportDTO(_DTO):
    dims_exact: int
    dims_conflict: int
    dims_unlinked: int
    walls_exact: int
    max_residual: float = Field(description="m: mayor diferencia entre cota y geometría")
    moved_max: float = Field(description="m: lo que más se movió un nodo")
    conflicts: list[str] = []


class SolveResultDTO(_DTO):
    project: ProjectDTO
    report: SolveReportDTO


class CaptureCheckDTO(_DTO):
    ok: bool
    sharpness: float
    glare: float = Field(description="fracción de la imagen con reflejo")
    width: int
    height: int
    paper_found: bool
    warnings: list[str] = []


class ProjectCreatedDTO(_DTO):
    id: str
    status: ProjectStatus


class CalibrateScaleDTO(_DTO):
    """Dos puntos (en píxeles de la imagen rectificada) y la distancia real entre ellos."""

    a: PointDTO
    b: PointDTO
    meters: float = Field(gt=0)


class CornersDTO(_DTO):
    corners: list[tuple[float, float]] | None = Field(
        description="Esquinas de la hoja detectadas (TL, TR, BR, BL) normalizadas 0..1, o null"
    )


class ReanalyzeDTO(_DTO):
    corners: list[tuple[float, float]] | None = Field(
        default=None, description="4 esquinas [x,y] normalizadas 0..1 (TL, TR, BR, BL)"
    )


StageStatus = Literal["started", "completed", "failed"]


class ProgressEventDTO(_DTO):
    project_id: str
    stage: str
    status: StageStatus
    index: int
    total: int
    elapsed_ms: float | None = None
    metrics: dict[str, float] = {}
    message: str | None = None
    preview: BuildingModelDTO | None = None


# --------------------------------------------------------------------------- mappers


def _p(p: Point2D) -> PointDTO:
    return PointDTO(x=p.x, y=p.y)


def _pt(d: PointDTO) -> Point2D:
    return Point2D(d.x, d.y)


def _opening_to_dto(o: Opening) -> OpeningDTO:
    return OpeningDTO(
        id=o.id,
        kind=o.kind,
        offset=o.offset,
        width=o.width,
        height=o.height,
        sill=o.sill,
        confidence=o.confidence,
        operation=o.operation,
        hinge_at_end=o.hinge_at_end,
        opens_left=o.opens_left,
    )


def _wall_to_dto(w: Wall) -> WallDTO:
    return WallDTO(
        id=w.id,
        start=_p(w.start),
        end=_p(w.end),
        thickness=w.thickness,
        height=w.height,
        material=w.material,
        confidence=w.confidence,
        length=w.length,
        openings=[_opening_to_dto(o) for o in w.openings],
        bulge=w.bulge,
        kind=w.kind,
        structural=w.structural,
        measure=MeasureDTO(
            status=w.measure.status,
            source=w.measure.source,
            error=w.measure.error,
            dimension_id=w.measure.dimension_id,
        ),
    )


def _room_to_dto(r: Room) -> RoomDTO:
    return RoomDTO(
        id=r.id,
        label=r.label,
        polygon=[_p(p) for p in r.polygon],
        confidence=r.confidence,
        area=r.area,
        centroid=_p(r.centroid),
        room_type=r.room_type,
        holes=[[_p(p) for p in h] for h in r.holes],
        declared_area=r.declared_area,
        floor_material=r.floor_material,
    )


def _dimension_to_dto(d: Dimension) -> DimensionDTO:
    return DimensionDTO(
        id=d.id,
        a=_p(d.a),
        b=_p(d.b),
        value=d.value,
        text=d.text,
        axis=d.axis,
        offset=d.offset,
        source=d.source,
        status=d.status,
        confidence=d.confidence,
        residual=d.residual,
        wall_ids=list(d.wall_ids),
        measured=d.measured,
    )


def _level_to_dto(lv: Level) -> LevelDTO:
    return LevelDTO(
        id=lv.id,
        name=lv.name,
        elevation=lv.elevation,
        height=lv.height,
        walls=[_wall_to_dto(w) for w in lv.walls],
        rooms=[_room_to_dto(r) for r in lv.rooms],
        columns=[
            ColumnDTO(
                id=c.id,
                center=_p(c.center),
                width=c.width,
                depth=c.depth,
                round=c.round,
                rotation=c.rotation,
                confidence=c.confidence,
            )
            for c in lv.columns
        ],
        stairs=[
            StairDTO(
                id=s.id,
                start=_p(s.start),
                end=_p(s.end),
                width=s.width,
                steps=s.steps,
                riser=s.riser,
                to_level_id=s.to_level_id,
                confidence=s.confidence,
                tread=s.tread,
                base=s.base,
            )
            for s in lv.stairs
        ],
        dimensions=[_dimension_to_dto(d) for d in lv.dimensions],
        furniture=[
            FurnitureDTO(
                id=f.id,
                catalog_id=f.catalog_id,
                position=_p(f.position),
                width=f.width,
                depth=f.depth,
                height=f.height,
                rotation=f.rotation,
            )
            for f in lv.furniture
        ],
        labels=[
            TextLabelDTO(
                id=t.id,
                position=_p(t.position),
                text=t.text,
                kind=t.kind,
                rotation=t.rotation,
                confidence=t.confidence,
            )
            for t in lv.labels
        ],
    )


def model_to_dto(m: BuildingModel) -> BuildingModelDTO:
    return BuildingModelDTO(
        project_id=m.project_id,
        scale=ScaleDTO(
            meters_per_pixel=m.scale.meters_per_pixel,
            source=m.scale.source,
            confidence=m.scale.confidence,
        ),
        source_image=(
            SourceImageDTO(
                key=m.source_image.key,
                width_px=m.source_image.width_px,
                height_px=m.source_image.height_px,
            )
            if m.source_image
            else None
        ),
        total_area=m.total_area,
        schema_version=m.schema_version,
        levels=[_level_to_dto(lv) for lv in m.levels],
    )


# ---- entrada: None → valor por defecto del dominio (así se lee un modelo v1)


def _opening_from_dto(o: OpeningDTO) -> Opening:
    return Opening(
        id=o.id,
        kind=o.kind,
        offset=o.offset,
        width=o.width,
        height=o.height,
        sill=o.sill,
        confidence=o.confidence,
        operation=o.operation,
        hinge_at_end=bool(o.hinge_at_end),
        opens_left=True if o.opens_left is None else o.opens_left,
    )


def _wall_from_dto(w: WallDTO) -> Wall:
    m = w.measure
    return Wall(
        id=w.id,
        start=_pt(w.start),
        end=_pt(w.end),
        thickness=w.thickness,
        height=w.height,
        material=w.material,
        confidence=w.confidence,
        openings=tuple(_opening_from_dto(o) for o in w.openings),
        bulge=w.bulge or 0.0,
        kind=w.kind or WallKind.UNKNOWN,
        structural=bool(w.structural),
        measure=Measure(m.status, m.source, m.error, m.dimension_id) if m else Measure(),
    )


def _room_from_dto(r: RoomDTO) -> Room:
    return Room(
        id=r.id,
        label=r.label,
        polygon=tuple(_pt(p) for p in r.polygon),
        confidence=r.confidence,
        room_type=r.room_type or RoomType.OTHER,
        holes=tuple(tuple(_pt(p) for p in h) for h in (r.holes or [])),
        declared_area=r.declared_area,
        floor_material=r.floor_material,
    )


def _dimension_from_dto(d: DimensionDTO) -> Dimension:
    return Dimension(
        id=d.id,
        a=_pt(d.a),
        b=_pt(d.b),
        value=d.value,
        text=d.text,
        axis=d.axis,
        offset=d.offset,
        source=d.source,
        status=d.status,
        confidence=d.confidence,
        residual=d.residual,
        wall_ids=tuple(d.wall_ids),
    )


def _level_from_dto(lv: LevelDTO) -> Level:
    return Level(
        id=lv.id,
        name=lv.name,
        elevation=lv.elevation,
        height=lv.height if lv.height is not None else 2.6,
        walls=tuple(_wall_from_dto(w) for w in lv.walls),
        rooms=tuple(_room_from_dto(r) for r in lv.rooms),
        columns=tuple(
            Column(
                id=c.id,
                center=_pt(c.center),
                width=c.width,
                depth=c.depth,
                round=c.round,
                rotation=c.rotation,
                confidence=c.confidence,
            )
            for c in (lv.columns or [])
        ),
        stairs=tuple(
            Stair(
                id=s.id,
                start=_pt(s.start),
                end=_pt(s.end),
                width=s.width,
                steps=s.steps,
                riser=s.riser,
                to_level_id=s.to_level_id,
                confidence=s.confidence,
                base=s.base,
            )
            for s in (lv.stairs or [])
        ),
        dimensions=tuple(_dimension_from_dto(d) for d in (lv.dimensions or [])),
        furniture=tuple(
            Furniture(
                id=f.id,
                catalog_id=f.catalog_id,
                position=_pt(f.position),
                width=f.width,
                depth=f.depth,
                height=f.height,
                rotation=f.rotation,
            )
            for f in (lv.furniture or [])
        ),
        labels=tuple(
            TextLabel(
                id=t.id,
                position=_pt(t.position),
                text=t.text,
                kind=t.kind,
                rotation=t.rotation,
                confidence=t.confidence,
            )
            for t in (lv.labels or [])
        ),
    )


def model_from_dto(d: BuildingModelDTO) -> BuildingModel:
    """Construye el dominio desde el DTO; lanza DomainError si viola invariantes.

    Un modelo sin ``schema_version`` (v1) se actualiza a la versión actual: todos los
    campos nuevos toman su valor por defecto.
    """
    return BuildingModel(
        project_id=d.project_id,
        scale=Scale(d.scale.meters_per_pixel, d.scale.source, d.scale.confidence),
        source_image=(
            SourceImage(d.source_image.key, d.source_image.width_px, d.source_image.height_px)
            if d.source_image
            else None
        ),
        levels=tuple(_level_from_dto(lv) for lv in d.levels),
        schema_version=MODEL_SCHEMA_VERSION,
    )


def project_to_summary(p: Project) -> ProjectSummaryDTO:
    return ProjectSummaryDTO(
        id=p.id,
        name=p.name,
        status=p.status,
        error=p.error,
        created_at=p.created_at,
        updated_at=p.updated_at,
        total_area=p.model.total_area if p.model else None,
        room_count=sum(len(lv.rooms) for lv in p.model.levels) if p.model else 0,
    )


def project_to_dto(p: Project) -> ProjectDTO:
    return ProjectDTO(
        **project_to_summary(p).model_dump(),
        model=model_to_dto(p.model) if p.model else None,
        revision=p.revision,
    )


def revision_to_dto(r: ModelRevision) -> RevisionDTO:
    return RevisionDTO(
        number=r.number,
        summary=r.summary,
        created_at=r.created_at,
        total_area=round(r.model.total_area, 3),
        wall_count=sum(len(lv.walls) for lv in r.model.levels),
    )


def stats_to_dto(s: CorrectionStats) -> CorrectionStatsDTO:
    return CorrectionStatsDTO(**asdict(s), correction_rate=round(s.correction_rate, 4))

"""DTOs (Pydantic): contrato público entre backend y frontend.

Se exportan a OpenAPI y el frontend genera sus tipos TypeScript desde ahí
(`npm run gen:api`), de modo que el esquema de BuildingModel tiene una sola definición.
Los campos derivados (``length``, ``area``, ``centroid``) son de solo salida: al
recibir un modelo se ignoran y el dominio los vuelve a calcular.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from plano3d.domain import (
    BuildingModel,
    Level,
    Opening,
    OpeningKind,
    Point2D,
    Project,
    ProjectStatus,
    Room,
    Scale,
    SourceImage,
    Wall,
)


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


class RoomDTO(_DTO):
    id: str
    label: str
    polygon: list[PointDTO]
    confidence: float = 1.0
    area: float | None = Field(default=None, description="solo salida, m²")
    centroid: PointDTO | None = Field(default=None, description="solo salida")


class LevelDTO(_DTO):
    id: str
    name: str
    elevation: float = 0.0
    walls: list[WallDTO] = []
    rooms: list[RoomDTO] = []


class ScaleDTO(_DTO):
    meters_per_pixel: float
    source: Literal["default", "estimated", "calibrated"] = "estimated"
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
        levels=[
            LevelDTO(
                id=lv.id,
                name=lv.name,
                elevation=lv.elevation,
                walls=[
                    WallDTO(
                        id=w.id,
                        start=_p(w.start),
                        end=_p(w.end),
                        thickness=w.thickness,
                        height=w.height,
                        material=w.material,
                        confidence=w.confidence,
                        length=w.length,
                        openings=[
                            OpeningDTO(
                                id=o.id,
                                kind=o.kind,
                                offset=o.offset,
                                width=o.width,
                                height=o.height,
                                sill=o.sill,
                                confidence=o.confidence,
                            )
                            for o in w.openings
                        ],
                    )
                    for w in lv.walls
                ],
                rooms=[
                    RoomDTO(
                        id=r.id,
                        label=r.label,
                        polygon=[_p(p) for p in r.polygon],
                        confidence=r.confidence,
                        area=r.area,
                        centroid=_p(r.centroid),
                    )
                    for r in lv.rooms
                ],
            )
            for lv in m.levels
        ],
    )


def model_from_dto(d: BuildingModelDTO) -> BuildingModel:
    """Construye el dominio desde el DTO; lanza DomainError si viola invariantes."""
    return BuildingModel(
        project_id=d.project_id,
        scale=Scale(d.scale.meters_per_pixel, d.scale.source, d.scale.confidence),
        source_image=(
            SourceImage(d.source_image.key, d.source_image.width_px, d.source_image.height_px)
            if d.source_image
            else None
        ),
        levels=tuple(
            Level(
                id=lv.id,
                name=lv.name,
                elevation=lv.elevation,
                walls=tuple(
                    Wall(
                        id=w.id,
                        start=_pt(w.start),
                        end=_pt(w.end),
                        thickness=w.thickness,
                        height=w.height,
                        material=w.material,
                        confidence=w.confidence,
                        openings=tuple(
                            Opening(
                                id=o.id,
                                kind=o.kind,
                                offset=o.offset,
                                width=o.width,
                                height=o.height,
                                sill=o.sill,
                                confidence=o.confidence,
                            )
                            for o in w.openings
                        ),
                    )
                    for w in lv.walls
                ),
                rooms=tuple(
                    Room(
                        id=r.id,
                        label=r.label,
                        polygon=tuple(_pt(p) for p in r.polygon),
                        confidence=r.confidence,
                    )
                    for r in lv.rooms
                ),
            )
            for lv in d.levels
        ),
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
    )

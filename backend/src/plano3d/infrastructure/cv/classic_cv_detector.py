"""Estrategia "classic-cv" (técnica A de los docs): visión por computadora sin ML."""

from __future__ import annotations

from plano3d.application.dto import BuildingModelDTO, model_to_dto
from plano3d.application.pipeline import Pipeline, PipelineStage
from plano3d.application.ports import (
    DetectionRequest,
    DetectionResult,
    FloorPlanDetector,
    ImageQuality,
    ProgressPublisher,
)
from plano3d.infrastructure.cv.context import CVContext
from plano3d.infrastructure.cv.imageio import encode_png
from plano3d.infrastructure.cv.stages.assemble import AssembleStage, build_model
from plano3d.infrastructure.cv.stages.ingest import IngestStage
from plano3d.infrastructure.cv.stages.openings import OpeningsStage
from plano3d.infrastructure.cv.stages.preprocess import PreprocessStage
from plano3d.infrastructure.cv.stages.rectify import RectifyStage
from plano3d.infrastructure.cv.stages.rooms import RoomsStage
from plano3d.infrastructure.cv.stages.scale import ScaleStage
from plano3d.infrastructure.cv.stages.topology import TopologyStage
from plano3d.infrastructure.cv.stages.walls import VectorizeStage, WallMaskStage

#: etapas tras las cuales ya hay algo que mostrar en el visor (revelado progresivo)
PREVIEW_AFTER = {"topology", "rooms"}


def default_stages() -> list[PipelineStage[CVContext]]:
    return [
        IngestStage(),
        RectifyStage(),
        PreprocessStage(),
        WallMaskStage(),
        VectorizeStage(),
        ScaleStage(),
        OpeningsStage(),
        TopologyStage(),
        RoomsStage(),
        AssembleStage(),
    ]


class _PreviewTracker:
    """Construye un modelo parcial solo después de las etapas que agregan geometría."""

    def __init__(self, keys: list[str]) -> None:
        self._keys = keys
        self._i = 0

    def __call__(self, ctx: CVContext) -> BuildingModelDTO | None:
        key = self._keys[self._i]
        self._i += 1
        if key in PREVIEW_AFTER and ctx.meters_per_pixel > 0:
            return model_to_dto(build_model(ctx))
        return None


class ClassicCVDetector(FloorPlanDetector):
    name = "classic-cv"

    def supports(self, quality: ImageQuality) -> bool:
        # es la estrategia base: siempre disponible como respaldo
        return quality.width >= 200 and quality.height >= 200

    async def detect(
        self, request: DetectionRequest, progress: ProgressPublisher
    ) -> DetectionResult:
        stages = default_stages()
        pipeline = Pipeline(stages, preview=_PreviewTracker([s.key for s in stages]))
        ctx = CVContext(
            project_id=request.project_id,
            image_bytes=request.image_bytes,
            content_type=request.content_type,
            corners=request.corners,
        )
        ctx = await pipeline.run(ctx, request.project_id, progress)
        model = ctx.require(ctx.model, "model")
        rectified = ctx.require(ctx.rectified, "rectified")
        metrics = {
            "walls": float(sum(len(lv.walls) for lv in model.levels)),
            "rooms": float(sum(len(lv.rooms) for lv in model.levels)),
            "meters_per_pixel": model.scale.meters_per_pixel,
        }
        return DetectionResult(model=model, rectified_png=encode_png(rectified), metrics=metrics)

"""Estrategias de detección para archivos vectoriales (ADR-013)."""

from __future__ import annotations

from collections.abc import Callable

from plano3d.application.dto import model_to_dto
from plano3d.application.pipeline import Pipeline
from plano3d.application.ports import (
    DetectionRequest,
    DetectionResult,
    DetectorName,
    FloorPlanDetector,
    ImageQuality,
    ProgressPublisher,
)
from plano3d.infrastructure.cv.imageio import encode_png
from plano3d.infrastructure.vector.builder import VectorContext, vector_stages
from plano3d.infrastructure.vector.dxf import looks_like_dxf, read_dxf
from plano3d.infrastructure.vector.pdf import is_vector_pdf, read_pdf
from plano3d.infrastructure.vector.primitives import Drawing


class _VectorDetector(FloorPlanDetector):
    inspects_quality = False
    reader: Callable[[bytes], Drawing]

    def supports(self, quality: ImageQuality) -> bool:
        return True

    async def detect(
        self, request: DetectionRequest, progress: ProgressPublisher
    ) -> DetectionResult:
        stages = vector_stages()
        pipeline = Pipeline(
            stages, preview=lambda c: model_to_dto(c.model) if c.model is not None else None
        )
        ctx = VectorContext(request.project_id, request.image_bytes, type(self).reader)
        ctx = await pipeline.run(ctx, request.project_id, progress)
        model = ctx.require(ctx.model, "model")
        preview = ctx.require(ctx.preview, "preview")
        lv = model.levels[0]
        metrics = {
            "walls": float(len(lv.walls)),
            "rooms": float(len(lv.rooms)),
            "dimensions": float(len(lv.dimensions)),
            "meters_per_pixel": model.scale.meters_per_pixel,
            **ctx.metrics,
        }
        return DetectionResult(model=model, rectified_png=encode_png(preview), metrics=metrics)


class DxfDetector(_VectorDetector):
    """DXF de AutoCAD/LibreCAD/BricsCAD: geometría y cotas exactas del archivo."""

    name: DetectorName = "vector-dxf"
    reader = staticmethod(read_dxf)

    def accepts(self, content_type: str, data: bytes) -> bool:
        return content_type == "application/dxf" or (
            content_type not in ("image/jpeg", "image/png", "image/webp", "application/pdf")
            and looks_like_dxf(data)
        )


class VectorPdfDetector(_VectorDetector):
    """PDF impreso desde CAD: geometría exacta; la escala sale de las cotas o del rótulo.

    Un PDF escaneado (solo una imagen) no lo acepta: lo procesa la visión clásica.
    """

    name: DetectorName = "vector-pdf"
    reader = staticmethod(read_pdf)

    def accepts(self, content_type: str, data: bytes) -> bool:
        return content_type == "application/pdf" and is_vector_pdf(data)

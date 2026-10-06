"""Estrategia "raster-vector" (ADR-014): foto → segmentos → cotas → escala → muros.

Reutiliza las etapas clásicas de la foto (ingesta, rectificación, limpieza) y el núcleo
vectorial del importador DXF/PDF (pares de caras → muros, ADR-013). En medio:
- vectoriza la tinta (``vectorize``);
- LEE LAS COTAS (``dimensions``) con un ``TextReader`` y fija la escala por consenso;
  sin cotas legibles, la estima por el espesor típico de los muros;
- pasa todo a metros con tolerancias de foto.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field, replace

import cv2

from plano3d.application.dto import model_to_dto
from plano3d.application.pipeline import Pipeline, PipelineStage
from plano3d.application.ports import (
    DetectionRequest,
    DetectionResult,
    DetectorName,
    FloorPlanDetector,
    ImageQuality,
    ProgressPublisher,
    TextReader,
)
from plano3d.domain import MeasureSource
from plano3d.domain.solver import solve_level
from plano3d.infrastructure.cv.context import CVContext, as_u8
from plano3d.infrastructure.cv.dimensions import (
    DimReading,
    find_dimension_lines,
    read_dimensions,
    scale_from_readings,
)
from plano3d.infrastructure.cv.imageio import encode_png
from plano3d.infrastructure.cv.stages.ingest import IngestStage
from plano3d.infrastructure.cv.stages.preprocess import PreprocessStage
from plano3d.infrastructure.cv.stages.rectify import RectifyStage
from plano3d.infrastructure.cv.vectorize import Vectorized, vectorize
from plano3d.infrastructure.vector.builder import (
    RoomsStage,
    VectorContext,
    WallsStage,
    assemble_model,
)
from plano3d.infrastructure.vector.primitives import ArcPrim, Closed, DimPrim, Drawing, Line
from plano3d.infrastructure.vector.walls import Tol, pair_lines

ASSUMED_WALL_M = 0.18
MIN_DIM_SUPPORT = 2
MIN_ROOMS_TO_TRUST = 1


@dataclass
class RasterContext(VectorContext):
    cv: CVContext | None = None
    vec: Vectorized | None = None
    readings: list[DimReading] = field(default_factory=list)


class _ClassicStage(PipelineStage[RasterContext]):
    """Adapter: una etapa de la CV clásica corriendo sobre el contexto raster."""

    def __init__(self, stage: PipelineStage[CVContext]) -> None:
        self._stage = stage
        self.key = stage.key
        self.title = stage.title

    def run(self, ctx: RasterContext) -> RasterContext:
        ctx.cv = self._stage.run(ctx.require(ctx.cv, "cv"))
        return ctx

    def metrics(self, ctx: RasterContext) -> dict[str, float]:
        return self._stage.metrics(ctx.require(ctx.cv, "cv"))


class VectorizeStage(PipelineStage[RasterContext]):
    key = "vectorize"
    title = "Vectorización de trazos"

    def run(self, ctx: RasterContext) -> RasterContext:
        cv = ctx.require(ctx.cv, "cv")
        ctx.vec = vectorize(cv.require(cv.ink, "ink"))
        return ctx

    def metrics(self, ctx: RasterContext) -> dict[str, float]:
        v = ctx.require(ctx.vec, "vec")
        return {"segments": float(len(v.faces) + len(v.strokes)), "arcs": float(len(v.arcs))}


class DimensionScaleStage(PipelineStage[RasterContext]):
    key = "dimensions"
    title = "Lectura de cotas y escala"

    def __init__(self, reader: TextReader | None) -> None:
        self._reader = reader

    def run(self, ctx: RasterContext) -> RasterContext:
        cv = ctx.require(ctx.cv, "cv")
        v = ctx.require(ctx.vec, "vec")
        ink = cv.require(cv.ink, "ink")
        img = cv.require(cv.rectified, "rectified")
        fit = None
        if self._reader is not None:
            gray = as_u8(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
            dims = find_dimension_lines(v.strokes, ink, v.stroke_px)
            band = max(14.0, 0.03 * min(gray.shape))
            readings = read_dimensions(gray, ink, dims, self._reader, band)
            fit, inliers = scale_from_readings(readings)
            if (
                fit is not None
                and fit.support >= MIN_DIM_SUPPORT
                and _plausible(v, fit.meters_per_unit)
            ):
                ctx.readings = inliers
            else:
                fit = None
        if fit is not None:
            ctx.mpp = fit.meters_per_unit
            ctx.scale_source = "dimensions"
            ctx.scale_confidence = min(0.95, 0.6 + 0.05 * fit.support)
            # dispersión de las cotas que la respaldan → error relativo de toda medida
            ratios = [r.meters / r.dim.line.length for r in ctx.readings]
            spread = statistics.pstdev(ratios) / ctx.mpp if len(ratios) > 1 else 0.01
            ctx.error_rel = max(0.002, spread)
            ctx.error_abs = 2 * ctx.mpp
        else:
            ctx.mpp = estimate_mpp(v)
            ctx.scale_source = "estimated"
            ctx.scale_confidence = 0.3
            ctx.error_rel = 0.08
            ctx.error_abs = 3 * ctx.mpp
        return ctx

    def metrics(self, ctx: RasterContext) -> dict[str, float]:
        return {
            "meters_per_pixel": round(ctx.mpp, 6),
            "dimensions_read": float(len(ctx.readings)),
            "scale_confidence": ctx.scale_confidence,
        }


def _plausible(v: Vectorized, mpp: float) -> bool:
    """Un plano de edificación mide entre 2 y 500 m: si la escala da otra cosa, las cotas
    se leyeron mal (p. ej. un superíndice perdido: "14⁰⁰" leído como "14" cm)."""
    lines = [*v.faces, *v.strokes]
    if not lines:
        return False
    xs = [x for ln in lines for x in (ln.x1, ln.x2)]
    ys = [y for ln in lines for y in (ln.y1, ln.y2)]
    extent = max(max(xs) - min(xs), max(ys) - min(ys)) * mpp
    return 2.0 <= extent <= 500.0


def estimate_mpp(v: Vectorized) -> float:
    """Sin cotas: el espesor de muro más frecuente (pares de caras) vale ~18 cm."""
    lines = [*v.faces, *v.strokes]
    pieces, _ = pair_lines(lines, t_min=3.0, t_max=40.0, tol=Tol(angle=2.5, parallel=3.0))
    if pieces:
        weights = [(p.thickness, p.chord) for p in pieces if p.chord > 4 * p.thickness]
        if weights:
            weights.sort()
            total = sum(w for _, w in weights)
            acc = 0.0
            for t, w in weights:
                acc += w
                if acc >= total / 2:
                    return ASSUMED_WALL_M / t
    xs = [x for ln in lines for x in (ln.x1, ln.x2)] or [0.0, 1.0]
    ys = [y for ln in lines for y in (ln.y1, ln.y2)] or [0.0, 1.0]
    extent = max(max(xs) - min(xs), max(ys) - min(ys), 1.0)
    return 12.0 / extent


class ToDrawingStage(PipelineStage[RasterContext]):
    key = "to_meters"
    title = "Geometría en metros"

    def run(self, ctx: RasterContext) -> RasterContext:
        v = ctx.require(ctx.vec, "vec")
        f = ctx.mpp
        dim_strokes = {r.dim.index // 1000 for r in ctx.readings}
        d = Drawing(exact_scale=False)
        d.lines = [
            Line(ln.x1 * f, ln.y1 * f, ln.x2 * f, ln.y2 * f)
            for i, ln in enumerate((*v.strokes, *v.faces))
            if i not in dim_strokes or i >= len(v.strokes)
        ]
        d.arcs = [ArcPrim(a.cx * f, a.cy * f, a.r * f, a.start, a.sweep) for a in v.arcs]
        d.closed = [
            Closed(tuple((float(x) * f, float(y) * f) for x, y in c.reshape(-1, 2)), True)
            for c in v.solids
        ]
        for r in ctx.readings:
            ln = r.dim.line
            horizontal = abs(ln.direction[1]) < 0.05
            vertical = abs(ln.direction[0]) < 0.05
            axis = "horizontal" if horizontal else ("vertical" if vertical else "aligned")
            d.dims.append(
                DimPrim(
                    (ln.x1 * f, ln.y1 * f),
                    (ln.x2 * f, ln.y2 * f),
                    r.meters,
                    r.text,
                    axis,
                    confidence=r.confidence,
                )
            )
        ctx.drawing = d
        px = 1.0 * f
        ctx.tol = Tol(
            angle=2.5, parallel=3 * px, concentric=4 * px, join=3 * px, regularize=4.0, snap=2.0
        )
        # los trazos ya vienen esqueletizados (un eje por trazo): basta con exigir que
        # las dos caras estén separadas más de un ancho de trazo
        ctx.t_min = max(0.05, (v.stroke_px + 1) * px)
        ctx.source = MeasureSource.SCALE
        return ctx


class RasterAssembleStage(PipelineStage[RasterContext]):
    key = "assemble"
    title = "Ensamblado del modelo"

    def run(self, ctx: RasterContext) -> RasterContext:
        cv = ctx.require(ctx.cv, "cv")
        ctx.preview = cv.require(cv.rectified, "rectified")
        ctx.model = assemble_model(ctx, ctx.require(ctx.drawing, "drawing"))
        return ctx

    def metrics(self, ctx: RasterContext) -> dict[str, float]:
        m = ctx.require(ctx.model, "model")
        return {"total_area_m2": round(m.total_area, 2)}


class SolveStage(PipelineStage[RasterContext]):
    """Las cotas leídas mandan: los muros se ajustan a ellas (ADR-015)."""

    key = "solve"
    title = "Ajuste a las cotas"

    def run(self, ctx: RasterContext) -> RasterContext:
        model = ctx.require(ctx.model, "model")
        if not any(lv.dimensions for lv in model.levels):
            return ctx
        sigma = max(0.02, ctx.error_abs + ctx.error_rel * 5)
        levels = []
        for lv in model.levels:
            solved, rep = solve_level(lv, sigma=sigma)
            levels.append(solved)
            ctx.metrics["dims_exact"] = float(rep.dims_exact)
            ctx.metrics["dims_conflict"] = float(rep.dims_conflict)
            ctx.metrics["walls_exact"] = float(rep.walls_exact)
        ctx.model = replace(model, levels=tuple(levels))
        return ctx

    def metrics(self, ctx: RasterContext) -> dict[str, float]:
        return {k: v for k, v in ctx.metrics.items() if k.startswith(("dims_", "walls_"))}


def raster_stages(reader: TextReader | None) -> list[PipelineStage[RasterContext]]:
    return [
        _ClassicStage(IngestStage()),
        _ClassicStage(RectifyStage()),
        _ClassicStage(PreprocessStage()),
        VectorizeStage(),
        DimensionScaleStage(reader),
        ToDrawingStage(),
        WallsStage(),  # type: ignore[list-item]
        RoomsStage(),  # type: ignore[list-item]
        RasterAssembleStage(),
        SolveStage(),
    ]


def run_sync(
    project_id: str,
    data: bytes,
    content_type: str,
    reader: TextReader | None,
    corners: list[tuple[float, float]] | None = None,
) -> RasterContext:
    """Corre el pipeline sin publicar progreso (scripts de evaluación y pruebas)."""
    ctx = RasterContext(project_id, data, _no_reader)
    ctx.cv = CVContext(project_id, data, content_type, corners)
    for stage in raster_stages(reader):
        ctx = stage.run(ctx)
    return ctx


def _no_reader(_: bytes) -> Drawing:
    raise RuntimeError("el contexto raster no lee archivos vectoriales")


class RasterVectorDetector(FloorPlanDetector):
    """Fotos e imágenes de planos complejos: muros en doble línea, achurados, curvos,
    columnas, escaleras; escala y medidas desde las cotas escritas en el plano."""

    name: DetectorName = "raster-vector"

    def __init__(self, reader: TextReader | None = None) -> None:
        self._reader = reader

    def supports(self, quality: ImageQuality) -> bool:
        return quality.width >= 400 and quality.height >= 400

    async def detect(
        self, request: DetectionRequest, progress: ProgressPublisher
    ) -> DetectionResult:
        stages = raster_stages(self._reader)
        pipeline = Pipeline(
            stages, preview=lambda c: model_to_dto(c.model) if c.model is not None else None
        )
        ctx = RasterContext(request.project_id, request.image_bytes, _no_reader)
        ctx.cv = CVContext(
            request.project_id, request.image_bytes, request.content_type, request.corners
        )
        ctx = await pipeline.run(ctx, request.project_id, progress)
        model = ctx.require(ctx.model, "model")
        cv = ctx.require(ctx.cv, "cv")
        lv = model.levels[0]
        metrics = {
            "walls": float(len(lv.walls)),
            "rooms": float(len(lv.rooms)),
            "dimensions": float(len(lv.dimensions)),
            "meters_per_pixel": model.scale.meters_per_pixel,
        }
        img = cv.require(cv.rectified, "rectified")
        return DetectionResult(model=model, rectified_png=encode_png(img), metrics=metrics)


class HybridPhotoDetector(FloorPlanDetector):
    """Composite: intenta la ruta raster-vector y, si no cierra ambientes, la CV clásica.

    Si la clásica gana pero raster-vector sí leyó la escala de las COTAS, se re-escala el
    modelo clásico con esa escala (mejor que la estimada por el espesor de los muros).
    """

    name: DetectorName = "raster-vector"

    def __init__(self, raster: FloorPlanDetector, classic: FloorPlanDetector) -> None:
        self._raster = raster
        self._classic = classic

    def supports(self, quality: ImageQuality) -> bool:
        return self._raster.supports(quality) or self._classic.supports(quality)

    async def detect(
        self, request: DetectionRequest, progress: ProgressPublisher
    ) -> DetectionResult:
        try:
            first = await self._raster.detect(request, progress)
        except Exception:
            return await self._classic.detect(request, progress)
        rooms = sum(len(lv.rooms) for lv in first.model.levels)
        if rooms >= MIN_ROOMS_TO_TRUST:
            return first
        second = await self._classic.detect(request, progress)
        rooms2 = sum(len(lv.rooms) for lv in second.model.levels)
        if rooms2 <= rooms:
            return first
        model = second.model
        if first.model.scale.source == "dimensions":
            model = model.recalibrated(first.model.scale.meters_per_pixel)
            model = replace(
                model,
                scale=first.model.scale,
                levels=tuple(
                    replace(lv, dimensions=first.model.levels[0].dimensions) if k == 0 else lv
                    for k, lv in enumerate(model.levels)
                ),
            )
        metrics = {**second.metrics, "fallback_classic": 1.0}
        return DetectionResult(model=model, rectified_png=second.rectified_png, metrics=metrics)

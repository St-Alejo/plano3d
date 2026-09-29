from plano3d.application.pipeline import PipelineStage
from plano3d.infrastructure.cv.context import CVContext
from plano3d.infrastructure.cv.imageio import decode


class IngestStage(PipelineStage[CVContext]):
    key = "ingest"
    title = "Lectura de la imagen"

    def run(self, ctx: CVContext) -> CVContext:
        ctx.original = decode(ctx.image_bytes, ctx.content_type)
        return ctx

    def metrics(self, ctx: CVContext) -> dict[str, float]:
        img = ctx.require(ctx.original, "original")
        return {"width_px": img.shape[1], "height_px": img.shape[0]}

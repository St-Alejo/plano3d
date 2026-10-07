"""Estimación inicial de escala (m/px). El usuario la corrige después con una cota conocida."""

from __future__ import annotations

import numpy as np

from plano3d.application.pipeline import PipelineStage
from plano3d.infrastructure.cv.context import CVContext, Segment

ASSUMED_WALL_M = 0.18  # promedio razonable entre muros interiores (0.12) y exteriores (0.25)
MIN_BUILDING_M = 5.0
MAX_BUILDING_M = 40.0
FALLBACK_BUILDING_M = 12.0


def weighted_thickness(segments: list[Segment]) -> float:
    t = np.array([s.thickness for s in segments])
    w = np.array([s.length for s in segments])
    order = np.argsort(t)
    cum = np.cumsum(w[order])
    return float(t[order][np.searchsorted(cum, cum[-1] / 2)])


def estimate_scale(segments: list[Segment]) -> tuple[float, float]:
    """Devuelve (metros_por_pixel, confianza)."""
    thickness = weighted_thickness(segments)
    mpp = ASSUMED_WALL_M / thickness
    xs = [x for s in segments for x in (s.x1, s.x2)]
    ys = [y for s in segments for y in (s.y1, s.y2)]
    extent_px = max(max(xs) - min(xs), max(ys) - min(ys))
    extent_m = extent_px * mpp
    if MIN_BUILDING_M <= extent_m <= MAX_BUILDING_M:
        return mpp, 0.35
    # el grosor dio algo absurdo (p. ej. muros dibujados muy finos): usa el tamaño típico
    return FALLBACK_BUILDING_M / extent_px, 0.15


class ScaleStage(PipelineStage[CVContext]):
    key = "scale"
    title = "Estimación de escala"

    def run(self, ctx: CVContext) -> CVContext:
        if ctx.scale_hint is not None:
            ctx.meters_per_pixel, ctx.scale_confidence = ctx.scale_hint
        else:
            ctx.meters_per_pixel, ctx.scale_confidence = estimate_scale(ctx.segments)
        return ctx

    def metrics(self, ctx: CVContext) -> dict[str, float]:
        return {
            "meters_per_pixel": round(ctx.meters_per_pixel, 5),
            "scale_confidence": ctx.scale_confidence,
        }

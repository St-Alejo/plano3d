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


#: ancho típico de una puerta batiente (interiores 0,80-0,90; exteriores 0,90-1,00)
TYPICAL_DOOR_M = 0.85
#: la escala por grosor de muro tiene esta confianza; por puertas, algo más
DOOR_SCALE_CONFIDENCE = 0.5


#: puertas concordantes mínimas para confiar en la escala por puertas
MIN_DOORS_FOR_SCALE = 3


def scale_from_doors(segments: list[Segment], prior_mpp: float = 0.0) -> float | None:
    """m/px a partir de las puertas con hoja reconocida, o None si no hay evidencia firme.

    Las puertas tienen un ancho mucho más estable que el grosor de los muros (que varía
    entre 0,10 y 0,30 m y se engorda al dibujar). Se exigen al menos dos puertas de ancho
    parecido; las que se alejan más del 25 % de la mediana (vanos dobles, corredizas) no
    cuentan. Si contradice por más del doble a la estimación previa (``prior_mpp``),
    probablemente las "puertas" son otra cosa y se descarta.
    """
    widths = [
        o.width for s in segments for o in s.openings if o.kind == "door" and o.operation is None
    ]
    if len(widths) < MIN_DOORS_FOR_SCALE:
        return None
    med = float(np.median(widths))
    close = [w for w in widths if abs(w - med) <= 0.25 * med]
    if len(close) < MIN_DOORS_FOR_SCALE:
        return None
    mpp = TYPICAL_DOOR_M / float(np.median(close))
    if prior_mpp > 0 and not 0.5 <= mpp / prior_mpp <= 2.0:
        return None
    xs = [x for s in segments for x in (s.x1, s.x2)]
    ys = [y for s in segments for y in (s.y1, s.y2)]
    extent_m = max(max(xs) - min(xs), max(ys) - min(ys)) * mpp
    return mpp if MIN_BUILDING_M <= extent_m <= MAX_BUILDING_M else None

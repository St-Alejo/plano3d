"""Escala por consenso de cotas (RANSAC): ¿cuántos metros vale una unidad del dibujo?

Cada cota leída aporta un par (longitud medida en el dibujo, valor escrito en metros).
Una sola cota mal leída no puede decidir la escala: gana la razón metros/unidad que
explica MÁS cotas a la vez dentro de una tolerancia relativa. Las que no encajan son
lecturas erróneas o cotas que no corresponden a esa línea.
"""

from __future__ import annotations

import statistics
from collections.abc import Hashable, Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class ScalePair:
    measured: float  # en unidades del dibujo (px, puntos, ...)
    meters: float  # valor escrito en la cota
    text_key: Hashable = None  # un mismo texto no puede contar dos veces
    line_key: Hashable = None  # ni una misma línea


@dataclass(frozen=True)
class ScaleFit:
    meters_per_unit: float
    inliers: tuple[int, ...]  # índices de los pares que la respaldan

    @property
    def support(self) -> int:
        return len(self.inliers)


def fit_scale(pairs: Sequence[ScalePair], rel_tol: float = 0.005) -> ScaleFit | None:
    """La razón con más pares coincidentes (uno por texto y por línea). None si no hay pares."""
    best: ScaleFit | None = None
    for cand in pairs:
        if cand.measured <= 0 or cand.meters <= 0:
            continue
        r = cand.meters / cand.measured
        close = sorted(
            (abs(p.meters / p.measured / r - 1), i)
            for i, p in enumerate(pairs)
            if p.measured > 0 and abs(p.meters / p.measured / r - 1) < rel_tol
        )
        seen_t: set[Hashable] = set()
        seen_l: set[Hashable] = set()
        chosen: list[int] = []
        for _, i in close:
            p = pairs[i]
            tk = p.text_key if p.text_key is not None else ("t", i)
            lk = p.line_key if p.line_key is not None else ("l", i)
            if tk in seen_t or lk in seen_l:
                continue
            seen_t.add(tk)
            seen_l.add(lk)
            chosen.append(i)
        if best is None or len(chosen) > best.support:
            ratio = statistics.median(pairs[i].meters / pairs[i].measured for i in chosen)
            best = ScaleFit(ratio, tuple(chosen))
    return best

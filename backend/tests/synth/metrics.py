"""Métricas geométricas contra la verdad de terreno (independientes de la escala detectada).

Todas trabajan en el mismo sistema de coordenadas (p. ej. píxeles de la imagen
rectificada); las tolerancias se pasan en esas unidades.

- ``wall_f1``: un muro detectado acierta si sus DOS extremos caen a menos de ``tol`` de
  los de un muro verdadero (en cualquier orden). Es la métrica estricta de esquinas.
- ``centerline_pr``: cobertura del eje muestreado (tolera muros partidos o unidos y
  sirve para muros curvos).
- ``opening_pr``: aberturas emparejadas por posición del centro y por tipo.
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Sequence

import numpy as np
import numpy.typing as npt

Pt = tuple[float, float]
Seg = tuple[Pt, Pt]


def _end_dist(a: Seg, b: Seg) -> float:
    d1 = max(math.dist(a[0], b[0]), math.dist(a[1], b[1]))
    d2 = max(math.dist(a[0], b[1]), math.dist(a[1], b[0]))
    return min(d1, d2)


def match_segments(det: Sequence[Seg], gt: Sequence[Seg], tol: float) -> list[tuple[int, int]]:
    """Emparejamiento voraz 1 a 1 por distancia de extremos (la menor primero)."""
    cands = sorted(
        (d, i, j)
        for i, s in enumerate(det)
        for j, g in enumerate(gt)
        if (d := _end_dist(s, g)) <= tol
    )
    used_d: set[int] = set()
    used_g: set[int] = set()
    pairs = []
    for _, i, j in cands:
        if i in used_d or j in used_g:
            continue
        used_d.add(i)
        used_g.add(j)
        pairs.append((i, j))
    return pairs


def prf(tp: int, n_det: int, n_gt: int) -> tuple[float, float, float]:
    p = tp / n_det if n_det else (1.0 if n_gt == 0 else 0.0)
    r = tp / n_gt if n_gt else 1.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return p, r, f


def wall_f1(det: Sequence[Seg], gt: Sequence[Seg], tol: float) -> float:
    return prf(len(match_segments(det, gt, tol)), len(det), len(gt))[2]


def _sample(polyline: Sequence[Pt], step: float) -> npt.NDArray[np.float64]:
    out: list[Pt] = []
    for a, b in itertools.pairwise(polyline):
        n = max(1, math.ceil(math.dist(a, b) / step))
        out += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n)]
    out.append(polyline[-1])
    return np.array(out, np.float64)


def _dist_to_segments(pts: npt.NDArray[np.float64], segs: Sequence[Seg]) -> npt.NDArray[np.float64]:
    if not segs:
        return np.full(len(pts), np.inf)
    a = np.array([s[0] for s in segs], np.float64)
    b = np.array([s[1] for s in segs], np.float64)
    ab = b - a
    denom = np.maximum((ab**2).sum(1), 1e-12)
    ap = pts[:, None, :] - a[None]
    t = np.clip((ap * ab[None]).sum(2) / denom[None], 0, 1)
    proj = a[None] + t[..., None] * ab[None]
    return np.asarray(np.sqrt(((pts[:, None, :] - proj) ** 2).sum(2)).min(1), np.float64)


def _polyline_segments(lines: Sequence[Sequence[Pt]]) -> list[Seg]:
    return [(a, b) for pl in lines for a, b in itertools.pairwise(pl)]


def centerline_pr(
    det: Sequence[Sequence[Pt]], gt: Sequence[Sequence[Pt]], tol: float, step: float
) -> tuple[float, float]:
    """(precisión, exhaustividad) del eje: fracción de puntos muestreados a menos de ``tol``."""
    det_pts = np.concatenate([_sample(p, step) for p in det]) if det else np.zeros((0, 2))
    gt_pts = np.concatenate([_sample(p, step) for p in gt]) if gt else np.zeros((0, 2))
    precision = (
        float((_dist_to_segments(det_pts, _polyline_segments(gt)) <= tol).mean())
        if len(det_pts)
        else 0.0
    )
    recall = (
        float((_dist_to_segments(gt_pts, _polyline_segments(det)) <= tol).mean())
        if len(gt_pts)
        else 1.0
    )
    return precision, recall


def opening_pr(
    det: Sequence[tuple[Pt, str]], gt: Sequence[tuple[Pt, str]], tol: float
) -> tuple[float, float]:
    cands = sorted(
        (d, i, j)
        for i, (p, k) in enumerate(det)
        for j, (q, kg) in enumerate(gt)
        if k == kg and (d := math.dist(p, q)) <= tol
    )
    used_d: set[int] = set()
    used_g: set[int] = set()
    for _, i, j in cands:
        if i not in used_d and j not in used_g:
            used_d.add(i)
            used_g.add(j)
    p, r, _ = prf(len(used_d), len(det), len(gt))
    return p, r

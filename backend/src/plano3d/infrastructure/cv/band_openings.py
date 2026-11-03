"""Puertas y ventanas sobre los muros de la banda, leídas por el peso del trazo.

En un plano a mano o impreso el muro se dibuja con trazo grueso; el vano de una ventana
lleva líneas finas continuas y el de una puerta líneas finas discontinuas (o nada) con
la hoja y su arco al lado. Por eso, a lo largo de cada eje: donde falta el trazo grueso
hay un vano; cada hoja cuya bisagra cae en una jamba da una puerta del ancho de su radio
y lo que sobra del vano es ventana si sus líneas son continuas (o si es demasiado ancho
para una puerta) y puerta si no.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import NamedTuple

import cv2
import numpy as np
import numpy.typing as npt

from plano3d.infrastructure.cv.context import Img, as_u8
from plano3d.infrastructure.vector.primitives import ArcPrim
from plano3d.infrastructure.vector.walls import OpeningCand, WallCand

#: más fino que esto es una línea de ventana, de puerta o de mueble; más grueso, muro
HEAVY_M = 0.034
#: a cada lado del muro se mira hasta aquí más allá de su media
REACH_M = 0.05
#: huecos del trazo grueso más cortos que esto son el trazo mal binarizado
BRIDGE_M = 0.06
#: trozos gruesos más cortos que esto (texto, marcas) no parten un vano
SPECK_M = 0.15
GAP_MIN_M = 0.45
GAP_MAX_M = 3.0
#: la bisagra queda a esta distancia de la jamba y del eje
JAMB_M = 0.25
#: un vano sin hoja más ancho que esto no es una puerta
DOOR_MAX_M = 1.3
#: fracción de la línea más continua del vano para leerlo como ventana
WINDOW_CONT = 0.7
LEAF_M = (0.5, 1.1)

_Mask = npt.NDArray[np.bool_]


def _sample(img: Img, w: WallCand, mpp: float, half: float) -> _Mask:
    """Rejilla (a lo largo x a lo ancho) de ``img`` alrededor del eje de ``w``."""
    x1, y1, x2, y2 = (v / mpp for v in (w.x1, w.y1, w.x2, w.y2))
    n = max(1, int(math.hypot(x2 - x1, y2 - y1)))
    dx, dy = (x2 - x1) / n, (y2 - y1) / n
    r = int(half / mpp)
    s = np.arange(n + 1)[:, None]
    q = np.arange(-r, r + 1)[None, :]
    xs = np.clip(np.round(x1 + dx * s - dy * q).astype(int), 0, img.shape[1] - 1)
    ys = np.clip(np.round(y1 + dy * s + dx * q).astype(int), 0, img.shape[0] - 1)
    out: _Mask = img[ys, xs] > 0
    return out


def _runs(mask: _Mask) -> list[tuple[int, int]]:
    edges = np.diff(np.concatenate(([0], mask.astype(np.int8), [0])))
    starts = np.flatnonzero(edges == 1)
    ends = np.flatnonzero(edges == -1)
    return list(zip(starts.tolist(), ends.tolist(), strict=True))


def _continuity(grid: _Mask, lo: int, hi: int) -> float:
    """Cobertura de la línea más continua del tramo (1 = una línea entera, sin cortes)."""
    return float(grid[lo:hi].mean(axis=0).max()) if hi > lo else 0.0


class _Leaf(NamedTuple):
    at: float  # bisagra, px a lo largo del eje
    r: float
    left: bool


def _leaves(w: WallCand, a: int, e: int, mpp: float, arcs: Sequence[ArcPrim]) -> list[_Leaf]:
    """Hojas con la bisagra en una jamba del vano [a, e] (px a lo largo del eje)."""
    dx, dy = w.direction
    jamb = JAMB_M / mpp
    out = []
    for arc in arcs:
        if not LEAF_M[0] <= arc.r * mpp <= LEAF_M[1] or arc.r > (e - a) * 1.6:
            continue
        px, py = arc.cx * mpp - w.x1, arc.cy * mpp - w.y1
        along = (px * dx + py * dy) / mpp
        if abs(px * dy - py * dx) > w.thickness / 2 + JAMB_M or not a - jamb <= along <= e + jamb:
            continue
        mx, my = arc.point(0.5)
        left = (mx - arc.cx) * -dy + (my - arc.cy) * dx > 0
        out.append(_Leaf(min(max(along, a), e), arc.r, left))
    return sorted(out, key=lambda lf: lf.at)


def _split(
    w: WallCand, a: int, e: int, ink: _Mask, mpp: float, arcs: Sequence[ArcPrim]
) -> list[OpeningCand]:
    pieces = [(a, e)]
    out: list[OpeningCand] = []
    slack = JAMB_M / mpp
    for leaf in _leaves(w, a, e, mpp, arcs):
        for i, (lo, hi) in enumerate(pieces):
            if not lo - 1 <= leaf.at <= hi + 1:
                continue
            width = min(leaf.r, hi - lo)
            h = int(leaf.at)
            sides = []  # la hoja abre hacia el lado del vano con líneas discontinuas
            if h + width <= hi + slack:
                d1 = int(min(hi, h + width))
                sides.append((_continuity(ink, h, d1), h, d1, False))
            if h - width >= lo - slack:
                d0 = int(max(lo, h - width))
                sides.append((_continuity(ink, d0, h), d0, h, True))
            if not sides:
                continue
            _, d0, d1, at_end = min(sides)
            if (d1 - d0) * mpp < 0.8 * GAP_MIN_M:
                continue
            out.append(
                OpeningCand(d0 * mpp, (d1 - d0) * mpp, "door", 0.9, "swing", at_end, leaf.left)
            )
            pieces[i : i + 1] = [p for p in ((lo, d0), (d1, hi)) if p[1] > p[0]]
            break
    for lo, hi in pieces:
        width = (hi - lo) * mpp
        if not GAP_MIN_M <= width <= GAP_MAX_M:  # más ancho: un tabique de trazo fino
            continue
        if width > DOOR_MAX_M or _continuity(ink, lo, hi) >= WINDOW_CONT:
            out.append(OpeningCand(lo * mpp, width, "window", 0.85))
        else:
            out.append(OpeningCand(lo * mpp, width, "door", 0.6))
    return out


def band_openings(
    ink: Img, walls: Sequence[WallCand], mpp: float, arcs: Sequence[ArcPrim] = ()
) -> list[list[OpeningCand]]:
    """Aberturas de cada muro (en metros desde ``p1``), en el orden de ``walls``.

    ``ink`` es la tinta binaria en px rectificados; los muros, en metros."""
    k = max(2, round(HEAVY_M / mpp))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    heavy = as_u8(cv2.morphologyEx(ink, cv2.MORPH_OPEN, kernel))
    bridge = np.ones((1, max(1, round(BRIDGE_M / mpp))), np.uint8)
    speck = SPECK_M / mpp
    result = []
    for w in walls:
        half = w.thickness / 2 + REACH_M
        thick = _sample(heavy, w, mpp, half).any(axis=1).astype(np.uint8)[None, :]
        solid: _Mask = cv2.morphologyEx(thick, cv2.MORPH_CLOSE, bridge)[0] > 0
        for lo, hi in _runs(solid):
            if hi - lo < speck and lo > 0 and hi < len(solid):
                solid[lo:hi] = False
        grid = _sample(ink, w, mpp, half)
        found: list[OpeningCand] = []
        for a, e in _runs(~solid):
            if (e - a) * mpp >= GAP_MIN_M:
                found += _split(w, a, e, grid, mpp, arcs)
        result.append(sorted(found, key=lambda o: o.offset))
    return result

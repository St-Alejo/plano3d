"""Muros desde la máscara de bandas, entre los ambientes ya detectados (fotos con cotas).

La banda que queda a menos de ``NEAR_M`` de un ambiente y fuera de todos es muro: así se
van las cotas exteriores, las burbujas de los ejes y lo que está lejos del edificio. Se
separa en tramos horizontales y verticales (apertura con una línea de ``RUN_M``) y cada
tramo coherente da un eje recto con su grosor. Los tramos colineales se unen a través de
las puertas y las aberturas que ya traían los muros por pares de caras se pasan al nuevo.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import cv2
import numpy as np
import numpy.typing as npt
from shapely.geometry import Polygon

from plano3d.infrastructure.cv.context import Img, as_u8
from plano3d.infrastructure.vector.walls import OpeningCand, WallCand, snap

#: el muro está pegado al ambiente: más lejos es una cota, un eje o una marca exterior
NEAR_M = 0.25
#: largo mínimo de una corrida para ser parte de un muro en esa dirección
RUN_M = 0.3
#: el centro de un tramo no salta más que esto (si salta, es otro muro o un mueble pegado)
JUMP_M = 0.08
MIN_LEN_M = 0.35
#: más grueso es un mueble o una mancha; más inclinado, una mezcla de piezas
MAX_THICK_M = 0.35
MAX_TILT = 0.05
#: dos tramos en la misma línea se unen si el hueco cabe una puerta
MERGE_OFFSET_M = 0.1
DOOR_GAP_M = 1.1
#: una abertura vieja se pasa al muro nuevo si su centro queda así de cerca del eje
OPENING_REACH_M = 0.15

#: (inicio, fin) a lo largo, centro inicial y final a lo ancho, grosor (m)
_Run = list[float]


def _runs(zone: Img, mpp: float, horizontal: bool) -> list[_Run]:
    k = max(3, round(RUN_M / mpp))
    part = cv2.morphologyEx(
        zone, cv2.MORPH_OPEN, np.ones((1, k) if horizontal else (k, 1), np.uint8)
    )
    n, labels = cv2.connectedComponents(part, connectivity=8)
    jump = JUMP_M / mpp
    out: list[_Run] = []
    for i in range(1, n):
        ys, xs = np.nonzero(labels == i)
        along, across = (xs, ys) if horizontal else (ys, xs)
        order = np.argsort(along, kind="stable")
        along, across = along[order], across[order]
        pos, idx = np.unique(along, return_index=True)
        groups = np.split(across, idx[1:])
        lo = np.array([g.min() for g in groups], np.float64)
        hi = np.array([g.max() for g in groups], np.float64)
        start = 0
        for j in range(1, len(pos) + 1):
            if j < len(pos):
                ref = float(np.median((lo[start:j] + hi[start:j]) / 2))
                if pos[j] - pos[j - 1] <= 2 and abs((lo[j] + hi[j]) / 2 - ref) <= jump:
                    continue
            piece = slice(start, j)
            start = j
            _fit(pos[piece], lo[piece], hi[piece], mpp, out)
    return out


def _fit(
    pos: npt.NDArray[np.int64],
    lo: npt.NDArray[np.float64],
    hi: npt.NDArray[np.float64],
    mpp: float,
    out: list[_Run],
) -> None:
    if (pos.max() - pos.min()) * mpp < MIN_LEN_M:
        return
    # grosor: percentil bajo, para que una marca o un mueble pegado no lo inflen
    thick = float(np.percentile(hi - lo + 1, 25)) * mpp
    slope, icept = np.polyfit(pos.astype(np.float64), (lo + hi) / 2, 1)
    if thick > MAX_THICK_M or abs(slope) > MAX_TILT:
        return
    a, b = float(pos.min()), float(pos.max())
    out.append([a, b, slope * a + icept, slope * b + icept, thick])


def _merge(runs: list[_Run], mpp: float) -> list[_Run]:
    merged: list[_Run] = []
    for r in sorted(runs, key=lambda r: r[0]):
        for m in merged:
            offset = abs((m[2] + m[3]) / 2 - (r[2] + r[3]) / 2) * mpp
            if offset < MERGE_OFFSET_M and (r[0] - m[1]) * mpp < DOOR_GAP_M:
                if r[1] > m[1]:
                    m[1], m[3] = r[1], r[3]
                m[4] = max(m[4], r[4])
                break
        else:
            merged.append(list(r))
    return merged


def band_walls(
    band: Img, rooms: Sequence[Polygon], mpp: float, old: Sequence[WallCand] = ()
) -> list[WallCand]:
    """Muros en METROS; ``band`` es la banda de muros (``wall_band``) en px rectificados."""
    inside = np.zeros(band.shape, np.uint8)
    for p in rooms:
        pts = (np.array(p.exterior.coords) / mpp).astype(np.int32)
        cv2.fillPoly(inside, [pts], 255)
    k = max(3, round(2 * NEAR_M / mpp) | 1)
    near = as_u8(cv2.dilate(inside, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))))
    zone = as_u8(cv2.bitwise_and(cv2.bitwise_and(band, near), cv2.bitwise_not(inside)))
    walls: list[WallCand] = []
    for horizontal in (True, False):
        for a, b, c0, c1, thick in _merge(_runs(zone, mpp, horizontal), mpp):
            if horizontal:
                x1, y1, x2, y2 = a, c0, b, c1
            else:
                x1, y1, x2, y2 = c0, a, c1, b
            walls.append(WallCand(x1 * mpp, y1 * mpp, x2 * mpp, y2 * mpp, round(thick, 3)))
    walls = snap(walls)
    _carry_openings(walls, old)
    return walls


def _carry_openings(walls: list[WallCand], old: Sequence[WallCand]) -> None:
    """Las puertas y ventanas leídas sobre los muros por pares de caras pasan al muro nuevo
    que tiene su centro sobre el eje (con el mismo desplazamiento a lo largo)."""
    for w0 in old:
        dx0, dy0 = w0.direction
        for o in w0.openings:
            cx = w0.x1 + dx0 * (o.offset + o.width / 2)
            cy = w0.y1 + dy0 * (o.offset + o.width / 2)
            for w in walls:
                dx, dy = w.direction
                along = (cx - w.x1) * dx + (cy - w.y1) * dy
                across = abs((cx - w.x1) * dy - (cy - w.y1) * dx)
                start = along - o.width / 2
                if across > OPENING_REACH_M or start < 0 or start + o.width > w.chord:
                    continue
                dot = dx * dx0 + dy * dy0
                if abs(dot) < math.cos(math.radians(10)):
                    continue
                if any(abs(start - p.offset) < p.width for p in w.openings):
                    break
                flip = dot < 0  # el muro nuevo va al revés: la bisagra y el giro también
                w.openings.append(
                    OpeningCand(
                        start,
                        o.width,
                        o.kind,
                        o.confidence,
                        o.operation,
                        o.hinge_at_end != flip,
                        o.opens_left != flip,
                    )
                )
                w.openings.sort(key=lambda p: p.offset)
                break

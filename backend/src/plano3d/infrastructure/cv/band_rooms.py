"""Ambientes desde la "máscara de bandas" (fotos con escala por cotas).

Con la escala conocida, un cierre morfológico de ~15 cm vuelve banda sólida las dos
caras de cada muro, y una apertura de ~8 cm borra lo que es trazo suelto (cotas,
muebles, hojas de puerta, peldaños). Lo libre que no toca el borde es interior.

Las puertas quedan abiertas: dos ambientes se tocan por un "cuello" de < 1 m. Dentro de
un componente se buscan núcleos (puntos a más de ``CORE_R_M`` del muro); si hay dos o
más, el componente se reparte entre ellos por watershed sobre la distancia al muro, que
corta justo en el cuello. Con un solo núcleo (o ninguno: baños, depósitos) queda entero.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import cv2
import numpy as np
import numpy.typing as npt
from shapely.geometry import Polygon
from shapely.ops import unary_union

from plano3d.infrastructure.cv.context import Img, as_u8

CLOSE_M = 0.15
OPEN_M = 0.08
#: radio del disco que NO pasa por una puerta (vanos de hasta ~0,8 m libres)
CORE_R_M = 0.42
#: un núcleo más chico es el ensanche de un pasillo, no un ambiente
CORE_MIN_M2 = 1.0
MIN_ROOM_M2 = 1.0
#: contacto más largo que esto entre dos piezas no es una puerta (ni un vano doble)
MAX_DOOR_M = 1.2
ISLAND_MAX_M2 = 0.6
#: una celda libre menor que un ambiente pero al menos así (ducha, closet) se une al vecino
CELL_MIN_M2 = 0.25
#: grosor máximo (en la banda) de la división que se cruza al unir una celda: ducha, tabique
PARTITION_M = 0.15
#: nicho del contorno más angosto que esto (inodoro, lavamanos, mueble) es del ambiente
NOTCH_M = 0.6
#: radio de un arco de hoja de puerta, y holgura entre la bisagra y el cuello
LEAF_M = (0.5, 1.1)
LEAF_SLACK_M = 0.3
#: un nicho es bastante más chico que el ambiente al que se abre
ALCOVE_RATIO = 0.4
#: ancho con que se borra una línea de cota (cubre el trazo y su borde)
DIM_ERASE_M = 0.03


def _disk(px: float) -> Img:
    k = max(3, round(px) | 1)
    return as_u8(cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))


def band_mask(ink: Img, mpp: float) -> Img:
    m = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, _disk(CLOSE_M / mpp))
    return as_u8(cv2.morphologyEx(m, cv2.MORPH_OPEN, _disk(OPEN_M / mpp)))


def _walls_only(band: Img, mpp: float) -> Img:
    """Una banda suelta (cama, mesa, texto, cota interior) no divide: los muros forman una
    red unida con el contorno. Se quitan las islas más chicas que ``ISLAND_MAX_M2``."""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(band, connectivity=8)
    small = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] * mpp * mpp < ISLAND_MAX_M2]
    if not small:
        return band
    out = band.copy()
    out[np.isin(labels, small)] = 0
    return out


def _filled(region: Img) -> Img:
    """Los muebles que quedaron como islas dentro del ambiente son parte del ambiente."""
    contours, _ = cv2.findContours(region, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(region, contours, -1, 255, cv2.FILLED)
    return region


def _split(comp: Img, mpp: float, hinges: Sequence[tuple[float, float, float]] = ()) -> list[Img]:
    # los CENTROS donde cabe el disco se etiquetan antes de reconstruir: dos discos a cada
    # lado de una puerta se solapan en el vano, pero sus centros no se tocan
    disk = _disk(2 * CORE_R_M / mpp)
    k, labels = cv2.connectedComponents(cv2.erode(comp, disk), connectivity=4)
    cover = np.zeros(comp.shape, np.int32)  # cuántos núcleos alcanzan cada píxel
    owner = np.zeros(comp.shape, np.int32)
    count = 0
    for j in range(1, k):
        core = as_u8(cv2.dilate((labels == j).astype(np.uint8), disk)) * (comp > 0)
        if np.count_nonzero(core) * mpp * mpp < CORE_MIN_M2:
            continue
        count += 1
        cover += core
        owner[core > 0] = count
    if count < 2:
        return [comp]
    owner[cover > 1] = 0  # lo disputado se reparte abajo, por borde compartido
    # lo que no entró en un núcleo (rincones, franjas junto al muro, cuellos, closets) va
    # entero al núcleo con el que comparte más borde: no "serpentea" a lo largo del muro
    rest = ((comp > 0) & (owner == 0)).astype(np.uint8)
    n, pieces, pstats, _ = cv2.connectedComponentsWithStats(rest, connectivity=4)
    ring = np.ones((3, 3), np.uint8)
    for i in range(1, n):
        x, y, w, h = (int(v) for v in pstats[i, :4])
        x0, y0 = max(0, x - 1), max(0, y - 1)
        win = (pieces[y0 : y + h + 1, x0 : x + w + 1] == i).astype(np.uint8)
        border = cv2.dilate(win, ring) > 0
        touching = owner[y0 : y + h + 1, x0 : x + w + 1][border]
        touching = touching[touching > 0]
        if touching.size:
            sub = owner[y0 : y + h + 1, x0 : x + w + 1]
            sub[win > 0] = int(np.bincount(touching).argmax())
    return _merge_open(owner, count, mpp, hinges)


def _merge_open(
    owner: npt.NDArray[np.int32],
    count: int,
    mpp: float,
    hinges: Sequence[tuple[float, float, float]] = (),
) -> list[Img]:
    """Dos piezas que se tocan a lo largo de más que una puerta no las separa un vano: son
    el mismo ambiente partido por peldaños o un mueble (escalera, rincón del sofá)."""
    parent = list(range(count + 1))

    def root(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    ring = np.ones((3, 3), np.uint8)
    masks = [(owner == s).astype(np.uint8) for s in range(count + 1)]
    areas = [int(np.count_nonzero(m)) for m in masks]
    contacts: list[tuple[int, int, float, bool]] = []
    degree = [0] * (count + 1)
    for a in range(1, count + 1):
        grown = cv2.dilate(masks[a], ring) > 0
        near = owner[grown & (masks[a] == 0)]
        for b in (int(v) for v in np.unique(near[near > a])):
            # largo del contacto = lo que abarca (la frontera en un vano puede ser curva)
            ys, xs = np.nonzero(grown & (masks[b] > 0))
            span = (max(int(xs.max() - xs.min()), int(ys.max() - ys.min())) + 1) * mpp
            cx, cy = float(xs.mean()), float(ys.mean())
            leaf = any(
                math.hypot(cx - hx, cy - hy) <= r + LEAF_SLACK_M / mpp for hx, hy, r in hinges
            )
            contacts.append((a, b, span, leaf))
            degree[a] += 1
            degree[b] += 1
    for a, b, span, leaf in contacts:
        # una pieza chica sin otra salida, unida por un cuello sin hoja de puerta (con arcos
        # detectados en el dibujo), es un nicho del vecino: closet abierto, una cota sobre
        # el pie de la cama que parece un muro con su vano
        small = min(areas[a], areas[b]) < ALCOVE_RATIO * max(areas[a], areas[b])
        alcove = bool(hinges) and not leaf and small and min(degree[a], degree[b]) == 1
        if span > MAX_DOOR_M or alcove:
            parent[root(b)] = root(a)
    groups: dict[int, Img] = {}
    for s in range(1, count + 1):
        r = root(s)
        groups[r] = as_u8(np.maximum(groups.get(r, np.zeros_like(masks[s])), masks[s]) * 255)
    return list(groups.values())


def wall_band(
    ink: Img, mpp: float, dim_lines: Sequence[tuple[float, float, float, float]] = ()
) -> Img:
    """Banda de los muros: sin las cotas reconocidas ni las islas de tinta."""
    if dim_lines:
        ink = ink.copy()
        t = max(2, round(DIM_ERASE_M / mpp))
        for x1, y1, x2, y2 in dim_lines:
            cv2.line(ink, (round(x1), round(y1)), (round(x2), round(y2)), 0, t)
    return _walls_only(band_mask(ink, mpp), mpp)


def band_rooms(
    ink: Img,
    mpp: float,
    dim_lines: Sequence[tuple[float, float, float, float]] = (),
    arcs: Sequence[tuple[float, float, float]] = (),
) -> list[Polygon]:
    """Ambientes en METROS (px de la imagen rectificada por mpp), de arriba abajo.

    ``dim_lines`` (px): líneas de cota ya reconocidas; se borran de la tinta antes, porque
    una cota sobre el pie de una cama se ve igual que un muro con su puerta.
    ``arcs`` (px): arcos del dibujo (centro, radio); los de tamaño de hoja marcan puertas.
    """
    hinges = [(x, y, r) for x, y, r in arcs if LEAF_M[0] <= r * mpp <= LEAF_M[1]]
    band = wall_band(ink, mpp, dim_lines)
    free = cv2.bitwise_not(band)
    h, w = band.shape
    n, labels, stats, _ = cv2.connectedComponentsWithStats(free, connectivity=4)
    min_px = MIN_ROOM_M2 / (mpp * mpp)
    regions: list[Img] = []
    cells: list[Img] = []
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if x == 0 or y == 0 or x + bw >= w or y + bh >= h:
            continue  # toca el borde: es el exterior
        comp = as_u8((labels == i).astype(np.uint8) * 255)
        if area < min_px:
            if area * mpp * mpp >= CELL_MIN_M2:
                cells.append(comp)
            continue
        regions.extend(r for r in _split(comp, mpp, hinges) if np.count_nonzero(r) >= min_px)
    _absorb_cells(regions, cells, mpp)
    rooms: list[Polygon] = []
    for raw in regions:
        # nichos de sanitarios y muebles adosados al muro: el ambiente es el recinto
        k = max(3, round(NOTCH_M / mpp))
        region = cv2.morphologyEx(_filled(raw), cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
        contours, _ = cv2.findContours(region, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        c = max(contours, key=cv2.contourArea)
        pts = cv2.approxPolyDP(c, max(1.5, 0.04 / mpp), True).reshape(-1, 2)
        if len(pts) < 3:
            continue
        poly = Polygon([(float(px) * mpp, float(py) * mpp) for px, py in pts]).buffer(0)
        if poly.geom_type == "MultiPolygon":
            poly = max(poly.geoms, key=lambda g: g.area)
        if poly.is_valid and poly.area >= MIN_ROOM_M2:
            rooms.append(poly)
    rooms = _disjoint(rooms)
    rooms.sort(key=lambda p: (round(p.centroid.y / 1.0), p.centroid.x))
    return rooms


def _absorb_cells(regions: list[Img], cells: list[Img], mpp: float) -> None:
    """Una celda chica para ser ambiente (ducha, closet) es parte del vecino del otro lado de
    la división delgada: se une a él, con la división incluida."""
    if not regions:
        return
    reach = _disk(2 * PARTITION_M / mpp)
    for cell in cells:
        grown = cv2.dilate(cell, reach) > 0
        hits = [np.count_nonzero(grown & (r > 0)) for r in regions]
        best = int(np.argmax(hits))
        if hits[best] == 0:
            continue
        joined = as_u8(np.maximum(regions[best], cell))
        regions[best] = as_u8(np.maximum(joined, cv2.morphologyEx(joined, cv2.MORPH_CLOSE, reach)))


def _disjoint(rooms: list[Polygon]) -> list[Polygon]:
    """Sin solapes (el modelo los rechaza): el relleno de islas puede envolver a un ambiente
    vecino y la simplificación del contorno invade unos cm. Mandan los más grandes; uno
    encerrado del todo por otro se descarta (el modelo usa solo el contorno exterior)."""
    out: list[Polygon] = []
    for poly in sorted(rooms, key=lambda p: -p.area):
        if out:
            rest = poly.difference(unary_union(out))
            if rest.geom_type == "MultiPolygon":
                rest = max(rest.geoms, key=lambda g: g.area)
            if rest.is_empty or rest.geom_type != "Polygon":
                continue
            poly = Polygon(rest.exterior).buffer(0)
            if any(poly.intersection(o).area > 0.01 * poly.area for o in out):
                continue
        if poly.area >= MIN_ROOM_M2:
            out.append(poly)
    return out

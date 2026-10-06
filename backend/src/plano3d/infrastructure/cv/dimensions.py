"""Cotas en una imagen: línea de cota + texto → pares (píxeles, metros) → escala.

1. **Líneas de cota**: trazos finos largos con una marca en CADA extremo (tick a 45°,
   línea de extensión perpendicular o flecha: segmentos cortos que cruzan el extremo).
2. **Texto**: en una banda paralela a cada lado de la línea, cerca de su mitad, se
   juntan los componentes de tinta que no son la línea; el recorte se endereza (las
   cotas verticales se leen girando 90°), se amplía 3 veces y se pasa a un ``TextReader``.
3. **Escala**: ``domain.scale_fit`` (RANSAC). Las cotas que no encajan se descartan.
"""

from __future__ import annotations

import itertools
from collections.abc import Sequence
from dataclasses import dataclass

import cv2
import numpy as np

from plano3d.application.ports import ReadText, TextReader
from plano3d.domain.plan_text import parse_length
from plano3d.domain.scale_fit import ScaleFit, ScalePair, fit_scale
from plano3d.infrastructure.cv.context import Img, as_u8
from plano3d.infrastructure.vector.primitives import Line

MAX_CROPS = 300
REC_HEIGHT = 40


@dataclass
class DimLine:
    line: Line  # píxeles de la imagen de trabajo
    index: int  # índice en la lista de trazos
    ticks: tuple[int, ...]  # índices de las marcas de los extremos


@dataclass
class DimReading:
    dim: DimLine
    text: str
    meters: float
    confidence: float
    center: tuple[float, float]  # centro del texto (px)
    crop: int = -1  # recorte del que salió (dos lecturas del mismo recorte compiten)


def _angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def _marks_along(ln: Line, ink: Img, stroke: float) -> list[float]:
    """Posiciones (px desde ``ln.p1``) donde la tinta sale perpendicular a la línea: ticks,
    flechas, puntos o líneas de extensión. Se mide el ancho de tinta a cada lado."""
    h, w = ink.shape
    ux, uy = ln.direction
    nx, ny = -uy, ux
    reach = int(max(6, 3 * stroke))
    base = stroke / 2 + 1.5
    ks = np.arange(-reach, int(ln.length) + reach + 1, dtype=np.float64)
    ts = np.arange(1, reach + 1, dtype=np.float64)
    cx = ln.x1 + ux * ks
    cy = ln.y1 + uy * ks
    ext = np.zeros(len(ks))
    for side in (1.0, -1.0):
        xs = np.rint(cx[:, None] + nx * side * ts[None, :]).astype(np.int64)
        ys = np.rint(cy[:, None] + ny * side * ts[None, :]).astype(np.int64)
        inside = (xs >= 0) & (xs < w) & (ys >= 0) & (ys < h)
        vals = np.zeros(xs.shape, bool)
        vals[inside] = ink[ys[inside], xs[inside]] > 0
        # largo de la racha de tinta que arranca junto a la línea
        run = np.cumprod(vals, axis=1).sum(axis=1)
        ext = np.maximum(ext, run)
    hits = [float(k) for k in ks[ext >= base + 3]]
    # agrupar: una marca en X o una flecha da salidas a ambos lados de su centro, hasta
    # ``reach`` px; todo lo que cae dentro de esa distancia es la misma marca
    marks: list[float] = []
    group: list[float] = []
    for pos in hits:
        if group and pos - group[0] > 2 * reach:
            marks.append((group[0] + group[-1]) / 2)
            group = []
        group.append(pos)
    if group:
        marks.append((group[0] + group[-1]) / 2)
    return marks


def _wall_faces(strokes: Sequence[Line], stroke: float, max_gap: float = 30.0) -> set[int]:
    """Trazos con una paralela cercana que los acompaña en al menos la mitad de su largo:
    son caras de muro (o de ventana), no líneas de cota."""
    by_angle: dict[int, list[int]] = {}
    for i, ln in enumerate(strokes):
        by_angle.setdefault(round(ln.angle / 2) % 90, []).append(i)
    out: set[int] = set()
    min_gap = 1.5 * stroke + 1
    for i, a in enumerate(strokes):
        if a.length < 20:
            continue
        ux, uy = a.direction
        nx, ny = -uy, ux
        k = round(a.angle / 2) % 90
        for j in (
            *by_angle.get((k - 1) % 90, []),
            *by_angle.get(k, []),
            *by_angle.get((k + 1) % 90, []),
        ):
            if j == i:
                continue
            b = strokes[j]
            if _angle_diff(a.angle, b.angle) > 3:
                continue
            d = ((b.x1 + b.x2) / 2 - a.x1) * nx + ((b.y1 + b.y2) / 2 - a.y1) * ny
            if not min_gap <= abs(d) <= max_gap:
                continue
            s1 = (b.x1 - a.x1) * ux + (b.y1 - a.y1) * uy
            s2 = (b.x2 - a.x1) * ux + (b.y2 - a.y1) * uy
            if min(a.length, max(s1, s2)) - max(0.0, min(s1, s2)) >= 0.5 * a.length:
                out.add(i)
                break
    return out


def find_dimension_lines(
    strokes: Sequence[Line], ink: Img, stroke: float, min_len: float = 30.0
) -> list[DimLine]:
    """Tramos entre marcas consecutivas sobre trazos largos.

    En una cadena de cotas la línea es continua y las marcas la cruzan: cada tramo entre
    dos marcas es una cota. Una cota necesita marca en sus DOS extremos.
    """
    out: list[DimLine] = []
    faces = _wall_faces(strokes, stroke)
    for i, ln in enumerate(strokes):
        if ln.length < min_len or i in faces:
            continue
        marks = _marks_along(ln, ink, stroke)
        if len(marks) < 2:
            continue
        ux, uy = ln.direction
        for a, b in itertools.pairwise(marks):
            if b - a < min_len:
                continue
            seg = Line(ln.x1 + ux * a, ln.y1 + uy * a, ln.x1 + ux * b, ln.y1 + uy * b, ln.layer)
            out.append(DimLine(seg, i * 1000 + len(out), ()))
    return out


def _looks_like_number(ink: Img) -> bool:
    """¿Hay al menos dos "caracteres" (componentes) de altura parecida, uno al lado del
    otro? Evita pasar al OCR recortes de muros, arcos o rayas sueltas."""
    n, _, stats, _ = cv2.connectedComponentsWithStats(as_u8(ink), connectivity=8)
    heights = [
        int(stats[i, cv2.CC_STAT_HEIGHT])
        for i in range(1, n)
        if stats[i, cv2.CC_STAT_HEIGHT] >= 4 and stats[i, cv2.CC_STAT_AREA] >= 6
    ]
    if len(heights) < 2:
        return False
    heights.sort()
    tall = heights[-1]
    similar = [hh for hh in heights if hh >= 0.5 * tall]
    return len(similar) >= 2 and tall <= 0.9 * ink.shape[0] + 2


def _text_crop(
    gray: Img, ink: Img, dim: DimLine, band: float, side: float
) -> tuple[Img, tuple[float, float], Img | None] | None:
    """Recorte enderezado del texto de un lado de la línea (None si no hay tinta)."""
    ln = dim.line
    ux, uy = ln.direction
    # dirección de lectura: de izquierda a derecha, o de abajo hacia arriba en verticales
    steep = abs(uy) > abs(ux)
    if (steep and uy > 0) or (not steep and ux < 0):
        ux, uy = -ux, -uy
    nx, ny = uy, -ux  # normal "hacia arriba del texto"
    cx, cy = (ln.x1 + ln.x2) / 2, (ln.y1 + ln.y2) / 2
    half = min(ln.length * 0.45, 12 * band)
    corners = []
    for s, t in ((-half, 2), (half, 2), (half, band), (-half, band)):
        corners.append((cx + ux * s + nx * t * side, cy + uy * s + ny * t * side))
    pts = np.array(corners, np.float32)
    w = round(2 * half)
    h = round(band - 2)
    if w < 6 or h < 6:
        return None
    if side > 0:
        dst = np.array([[0, h], [w, h], [w, 0], [0, 0]], np.float32)
    else:
        dst = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    m = cv2.getPerspectiveTransform(pts, dst)
    patch_ink = cv2.warpPerspective(ink, m, (w, h), flags=cv2.INTER_NEAREST)
    if side < 0:
        patch_ink = patch_ink[::-1]
    cols = np.where(patch_ink.max(axis=0) > 0)[0]
    rows = np.where(patch_ink.max(axis=1) > 0)[0]
    if cols.size < 3 or rows.size < 3:
        return None
    # el texto está cerca del centro de la cota: el bloque de columnas con tinta que
    # contiene (o queda más cerca de) la mitad
    groups: list[list[int]] = [[int(cols[0])]]
    for c in cols[1:]:
        if c - groups[-1][-1] <= max(4, h // 3):
            groups[-1].append(int(c))
        else:
            groups.append([int(c)])
    mid = w / 2
    g = min(
        groups, key=lambda g: 0 if g[0] <= mid <= g[-1] else min(abs(g[0] - mid), abs(g[-1] - mid))
    )
    x0, x1 = max(0, g[0] - 3), min(w, g[-1] + 4)
    y0, y1 = max(0, int(rows[0]) - 3), min(h, int(rows[-1]) + 4)
    if x1 - x0 > 6 * band or y1 - y0 < 6:
        return None  # demasiado ancho (o bajo) para ser el texto de una cota
    if not _looks_like_number(as_u8(patch_ink[y0:y1, x0:x1])):
        return None
    if x1 - x0 < 4 or y1 - y0 < 4:
        return None
    patch = cv2.warpPerspective(gray, m, (w, h), flags=cv2.INTER_CUBIC, borderValue=255)
    if side < 0:
        patch = patch[::-1]
    split = superscript_split(as_u8(patch_ink[y0:y1, x0:x1]))
    if split is None:
        main, sup = _to_rec(patch[y0:y1, x0:x1]), None
    else:
        main = _to_rec(patch[y0:y1, x0 : x0 + split])
        sup = _to_rec(patch[y0:y1, x0 + split : x1])
    # centro del texto en la imagen
    tx = cx + ux * ((x0 + x1) / 2 - mid) + nx * side * (band - (y0 + y1) / 2)
    ty = cy + uy * ((x0 + x1) / 2 - mid) + ny * side * (band - (y0 + y1) / 2)
    return main, (tx, ty), sup


def _to_rec(region: np.ndarray) -> Img:
    """Recorte listo para el reconocedor: texto de ~REC_HEIGHT px de alto, con borde."""
    k = REC_HEIGHT / max(1, region.shape[0])
    crop = cv2.resize(region, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    crop = cv2.copyMakeBorder(crop, 8, 8, 12, 12, cv2.BORDER_CONSTANT, value=255)
    return as_u8(cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR))


def superscript_split(ink: Img) -> int | None:
    """Columna donde empieza un superíndice (``3⁵⁰``): caracteres más chicos y ELEVADOS a
    la derecha del número principal. None si no hay superíndice."""
    n, _, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    comps = [
        (int(stats[i, 0]), int(stats[i, 1]), int(stats[i, 2]), int(stats[i, 3]))
        for i in range(1, n)
        if stats[i, cv2.CC_STAT_AREA] >= 4
    ]
    if len(comps) < 2:
        return None
    tall = max(c[3] for c in comps)
    base = max(c[1] + c[3] for c in comps if c[3] >= 0.8 * tall)  # línea base del número
    small = [c for c in comps if c[3] <= 0.75 * tall and c[1] + c[3] <= base - 0.3 * tall]
    big = [c for c in comps if c not in small and c[3] >= 0.5 * tall]
    if not small or not big:
        return None
    start = min(c[0] for c in small)
    if start < max(c[0] + c[2] for c in big) - 1:
        return None  # el "superíndice" no está a la derecha del número
    return max(1, start - 1)


def read_dimensions(
    gray: Img, ink: Img, dims: Sequence[DimLine], reader: TextReader, band: float
) -> list[DimReading]:
    """Lee el texto junto a cada línea de cota (los dos lados) y lo interpreta."""
    jobs: list[tuple[DimLine, tuple[float, float], int]] = []  # (cota, centro, superíndice)
    crops: list[Img] = []
    for d in sorted(dims, key=lambda d: -d.line.length):
        for side in (1.0, -1.0):
            got = _text_crop(gray, ink, d, band, side)
            if got is None:
                continue
            main, center, sup = got
            ch, cw = main.shape[:2]
            if sup is None and cw - 24 < 0.6 * (ch - 16):
                continue  # más alto que ancho: no es el número de una cota
            crops.append(main)
            sup_index = -1
            if sup is not None:
                crops.append(sup)
                sup_index = len(crops) - 1
            jobs.append((d, center, sup_index))
        if len(crops) >= MAX_CROPS:
            break
    if not crops:
        return []
    results: list[ReadText] = reader.read(crops)
    out = []
    i = 0
    for k, (d, center, sup_index) in enumerate(jobs):
        res = results[i]
        i += 1
        text = res.text.replace(" ", "")
        if sup_index >= 0:
            sup_text = results[sup_index].text.strip()
            i += 1
            if sup_text.isdigit():
                text = f"{text}^{sup_text}"
                res = ReadText(text, min(res.confidence, results[sup_index].confidence))
        parsed = parse_length(text)
        if parsed is None:
            continue
        # un entero sin unidad puede ser cm ("345") o m ("14" de un "14⁰⁰" mal leído): las
        # dos lecturas compiten en el consenso; solo una puede ganar (misma clave)
        values = [parsed.meters]
        if parsed.ambiguous:
            values.append(parsed.meters * 100)
        for value in values:
            if 0.1 <= value <= 200:
                out.append(DimReading(d, res.text, value, res.confidence, center, k))
    return out


def scale_from_readings(readings: Sequence[DimReading]) -> tuple[ScaleFit | None, list[DimReading]]:
    pairs = [
        ScalePair(r.dim.line.length, r.meters, r.crop if r.crop >= 0 else id(r), r.dim.index)
        for r in readings
    ]
    fit = fit_scale(pairs, rel_tol=0.02)
    if fit is None:
        return None, []
    return fit, [readings[i] for i in fit.inliers]

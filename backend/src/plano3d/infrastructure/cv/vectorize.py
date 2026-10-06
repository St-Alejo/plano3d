"""Vectorización de la tinta de una foto o escaneo → segmentos y arcos (en píxeles).

Convierte la imagen binaria en el mismo tipo de primitivas que trae un DXF, para usar el
núcleo geométrico vectorial (pares de caras → muros, ADR-013) también con fotos:

- **Trazos gruesos** (muros rellenos, poché, columnas): sus CONTORNOS son las caras.
- **Trazos finos** (muros en doble línea, ventanas, puertas, muebles, cotas): LSD da los
  dos bordes de cada trazo; se colapsan en su eje.
- **Achurado**: haces de líneas cortas paralelas y equiespaciadas dentro de una banda se
  descartan (el contorno del muro achurado sí queda).
- **Arcos**: cadenas de segmentos cortos que giran de a poco se ajustan a un círculo
  (arcos de giro de puertas y muros curvos).
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass

import cv2
import numpy as np
import numpy.typing as npt

from plano3d.infrastructure.cv.context import Img, as_u8
from plano3d.infrastructure.vector.primitives import ArcPrim, Line

Px = tuple[float, float]


@dataclass
class InkLayers:
    thick: Img  # 255 = trazo grueso (relleno)
    thin: Img  # 255 = trazo fino (sin texto)
    stroke_px: float  # ancho típico del trazo fino
    small_solids: list[npt.NDArray[np.int32]]  # contornos de manchas sólidas pequeñas


def stroke_width(ink: Img) -> float:
    """Ancho típico de los trazos finos (moda del doble de la distancia al borde en la
    cresta), robusto a que haya pocos muros rellenos."""
    dt = cv2.distanceTransform(ink, cv2.DIST_L2, 3)
    ridge = (dt >= cv2.dilate(dt, np.ones((3, 3), np.uint8))) & (dt > 0)
    vals = dt[ridge]
    if vals.size == 0:
        return 1.0
    hist, edges = np.histogram(vals, bins=np.arange(0.5, 12.5, 0.5))
    return float(max(1.0, 2 * edges[int(np.argmax(hist))] + 0.5))


def split_ink(ink: Img) -> InkLayers:
    """Separa lo grueso (≥ ~2,5 veces el trazo fino) de lo fino."""
    sw = stroke_width(ink)
    k = max(3, round(2.5 * sw) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    thick = as_u8(cv2.morphologyEx(ink, cv2.MORPH_OPEN, kernel))
    grown = cv2.dilate(thick, np.ones((3, 3), np.uint8))
    thin = as_u8(cv2.bitwise_and(ink, cv2.bitwise_not(grown)))
    thin = _drop_text(thin)
    # manchas sólidas pequeñas y compactas (columnas, puntos de cota, texto en negrita)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(thick, connectivity=8)
    small: list[npt.NDArray[np.int32]] = []
    diag = math.hypot(*ink.shape)
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if max(w, h) > 0.06 * diag:
            continue
        fill = area / max(1, w * h)
        if fill > 0.75 and max(w, h) <= 3 * min(w, h):
            comp = as_u8((labels[y : y + h, x : x + w] == i) * 255)
            cs, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if cs:
                small.append(np.asarray(cs[0] + np.array([x, y]), np.int32))
    return InkLayers(thick, thin, sw, small)


def _drop_text(thin: Img) -> Img:
    """Quita del trazo fino los componentes chicos y aislados (letras, números): no son
    geometría, y esqueletizados dan miles de segmentos inútiles. Las marcas de las cotas
    y los arcos de las puertas sobreviven porque están unidos a líneas largas."""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(thin, connectivity=8)
    limit = max(12.0, 0.012 * math.hypot(*thin.shape))
    keep = np.ones(n, np.uint8) * 255
    keep[0] = 0
    small = np.maximum(stats[:, cv2.CC_STAT_WIDTH], stats[:, cv2.CC_STAT_HEIGHT]) <= limit
    keep[small] = 0
    keep[0] = 0
    return as_u8(keep[labels])


# ----------------------------------------------------------------------------- caras


def thick_faces(thick: Img, eps: float = 1.0, min_len: float = 3.0) -> list[Line]:
    """Bordes de las manchas gruesas como segmentos (las caras de los muros rellenos)."""
    contours, _ = cv2.findContours(thick, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    lines: list[Line] = []
    for c in contours:
        if len(c) < 4:
            continue
        poly = cv2.approxPolyDP(c, eps, True).reshape(-1, 2).astype(np.float64)
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            if math.dist(a, b) >= min_len:
                lines.append(Line(float(a[0]), float(a[1]), float(b[0]), float(b[1]), "thick"))
    return lines


def trace_skeleton(skel: Img, eps: float = 1.2, min_len: float = 3.0) -> list[Line]:
    """Ejes de 1 px → segmentos (Douglas-Peucker sobre el contorno del esqueleto).

    El contorno de una línea de 1 px la recorre de ida y de vuelta: cada tramo sale dos
    veces y ``collapse_strokes`` los une.
    """
    contours, _ = cv2.findContours(skel, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    out: list[Line] = []
    for c in contours:
        if len(c) < 3:
            continue
        poly = cv2.approxPolyDP(c, eps, True).reshape(-1, 2).astype(np.float64)
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            if math.dist(a, b) >= min_len:
                out.append(Line(float(a[0]), float(a[1]), float(b[0]), float(b[1]), "thin"))
    return out


def _lsd(img: Img) -> list[Line]:
    lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    found = lsd.detect(img)[0]
    if found is None:
        return []
    return [
        Line(float(a), float(b), float(c), float(d), "thin") for a, b, c, d in found.reshape(-1, 4)
    ]


class _Grid:
    """Índice espacial de segmentos por celdas: compara solo con los vecinos."""

    def __init__(self, cell: float) -> None:
        self.cell = cell
        self.cells: dict[tuple[int, int], set[int]] = {}
        self.boxes: dict[int, tuple[int, int, int, int]] = {}

    def _box(self, ln: Line, pad: float) -> tuple[int, int, int, int]:
        c = self.cell
        return (
            math.floor((min(ln.x1, ln.x2) - pad) / c),
            math.floor((min(ln.y1, ln.y2) - pad) / c),
            math.floor((max(ln.x1, ln.x2) + pad) / c),
            math.floor((max(ln.y1, ln.y2) + pad) / c),
        )

    def add(self, k: int, ln: Line) -> None:
        box = self._box(ln, 0.0)
        self.boxes[k] = box
        for cx in range(box[0], box[2] + 1):
            for cy in range(box[1], box[3] + 1):
                self.cells.setdefault((cx, cy), set()).add(k)

    def remove(self, k: int) -> None:
        box = self.boxes.pop(k)
        for cx in range(box[0], box[2] + 1):
            for cy in range(box[1], box[3] + 1):
                self.cells[(cx, cy)].discard(k)

    def near(self, ln: Line, pad: float) -> set[int]:
        box = self._box(ln, pad)
        out: set[int] = set()
        for cx in range(box[0], box[2] + 1):
            for cy in range(box[1], box[3] + 1):
                out |= self.cells.get((cx, cy), set())
        return out


def collapse_strokes(lines: list[Line], width: float) -> list[Line]:
    """Los dos bordes paralelos de un trazo fino (≤ ancho + 1,5 px) → su eje."""
    grid = _Grid(32.0)
    for k, ln in enumerate(lines):
        grid.add(k, ln)
    used = [False] * len(lines)
    out: list[Line] = []
    order = sorted(range(len(lines)), key=lambda i: -lines[i].length)
    for i in order:
        if used[i]:
            continue
        a = lines[i]
        used[i] = True
        u = a.direction
        n = (-u[1], u[0])
        group = [(0.0, 0.0, a.length, a)]
        for j in sorted(grid.near(a, width + 4)):
            if used[j]:
                continue
            b = lines[j]
            ang = abs(a.angle - b.angle) % 180
            if min(ang, 180 - ang) > 4:
                continue
            d1 = (b.x1 - a.x1) * n[0] + (b.y1 - a.y1) * n[1]
            d2 = (b.x2 - a.x1) * n[0] + (b.y2 - a.y1) * n[1]
            if max(abs(d1), abs(d2)) > width + 1.5:
                continue
            s1 = (b.x1 - a.x1) * u[0] + (b.y1 - a.y1) * u[1]
            s2 = (b.x2 - a.x1) * u[0] + (b.y2 - a.y1) * u[1]
            lo, hi = min(s1, s2), max(s1, s2)
            if hi < -2 or lo > a.length + 2:
                continue
            used[j] = True
            group.append(((d1 + d2) / 2, lo, hi, b))
        off = sum(g[0] for g in group) / len(group)
        lo = min(g[1] for g in group)
        hi = max(g[2] for g in group)
        p = (a.x1 + n[0] * off / 2, a.y1 + n[1] * off / 2)
        out.append(
            Line(p[0] + u[0] * lo, p[1] + u[1] * lo, p[0] + u[0] * hi, p[1] + u[1] * hi, a.layer)
        )
    return out


def merge_collinear(lines: list[Line], gap: float, offset: float = 1.5) -> list[Line]:
    """Une segmentos colineales separados por menos de ``gap`` px (LSD suele cortarlos)."""
    lines = sorted(lines, key=lambda ln: -ln.length)
    out: list[Line] = []
    grid = _Grid(32.0)
    for ln in lines:
        merged = False
        for k in sorted(grid.near(ln, gap + offset)):
            o = out[k]
            ang = abs(o.angle - ln.angle) % 180
            if min(ang, 180 - ang) > 2 or o.layer != ln.layer:
                continue
            u = o.direction
            n = (-u[1], u[0])
            d1 = (ln.x1 - o.x1) * n[0] + (ln.y1 - o.y1) * n[1]
            d2 = (ln.x2 - o.x1) * n[0] + (ln.y2 - o.y1) * n[1]
            if max(abs(d1), abs(d2)) > offset:
                continue
            s1 = (ln.x1 - o.x1) * u[0] + (ln.y1 - o.y1) * u[1]
            s2 = (ln.x2 - o.x1) * u[0] + (ln.y2 - o.y1) * u[1]
            lo, hi = min(s1, s2), max(s1, s2)
            if lo > o.length + gap or hi < -gap:
                continue
            nlo, nhi = min(0.0, lo), max(o.length, hi)
            out[k] = Line(
                o.x1 + u[0] * nlo, o.y1 + u[1] * nlo, o.x1 + u[0] * nhi, o.y1 + u[1] * nhi, o.layer
            )
            grid.remove(k)
            grid.add(k, out[k])
            merged = True
            break
        if not merged:
            grid.add(len(out), ln)
            out.append(ln)
    return out


def skeleton(mask: Img) -> Img:
    """Adelgazamiento de Zhang-Suen (vectorizado): trazos → ejes de 1 px, conexos."""
    img = (mask > 0).astype(np.uint8)
    img = np.pad(img, 1)
    while True:
        changed = False
        for step in (0, 1):
            p2 = img[:-2, 1:-1]
            p3 = img[:-2, 2:]
            p4 = img[1:-1, 2:]
            p5 = img[2:, 2:]
            p6 = img[2:, 1:-1]
            p7 = img[2:, :-2]
            p8 = img[1:-1, :-2]
            p9 = img[:-2, :-2]
            c = img[1:-1, 1:-1]
            nb = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
            seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
            trans = sum(((seq[k] == 0) & (seq[k + 1] == 1)).astype(np.uint8) for k in range(8))
            if step == 0:
                cond = (p2 * p4 * p6 == 0) & (p4 * p6 * p8 == 0)
            else:
                cond = (p2 * p4 * p8 == 0) & (p2 * p6 * p8 == 0)
            kill = (c == 1) & (nb >= 2) & (nb <= 6) & (trans == 1) & cond
            if kill.any():
                img[1:-1, 1:-1][kill] = 0
                changed = True
        if not changed:
            break
    return as_u8(img[1:-1, 1:-1] * 255)


# ----------------------------------------------------------------------------- achurado


def hatch_indices(lines: list[Line], max_len: float, min_count: int = 4) -> set[int]:
    """Haces de líneas cortas paralelas (achurado): al menos ``min_count`` con el mismo ángulo
    cuyos centros quedan a menos de 3 largos uno de otro."""
    short = [i for i, ln in enumerate(lines) if ln.length <= max_len]
    found: set[int] = set()
    by_angle: dict[int, list[int]] = {}
    for i in short:
        by_angle.setdefault(round(lines[i].angle / 3), []).append(i)
    for idxs in by_angle.values():
        if len(idxs) < min_count:
            continue
        mids = np.array(
            [((lines[i].x1 + lines[i].x2) / 2, (lines[i].y1 + lines[i].y2) / 2) for i in idxs]
        )
        for k, i in enumerate(idxs):
            d = np.hypot(*(mids - mids[k]).T)
            if (d <= 3 * lines[i].length).sum() >= min_count:
                found.add(i)
    return found


def hatch_region(shape: tuple[int, ...], hatch: list[Line]) -> Img:
    """Zona achurada rellena: las rayas engrosadas y cerradas entre sí."""
    mask = np.zeros(shape[:2], np.uint8)
    for ln in hatch:
        cv2.line(mask, (round(ln.x1), round(ln.y1)), (round(ln.x2), round(ln.y2)), 255, 3)
    lengths = sorted(ln.length for ln in hatch)
    k = max(5, round(0.6 * lengths[len(lengths) // 2])) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    return as_u8(cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel))


# ----------------------------------------------------------------------------- arcos


def arcs_from_segments(
    lines: list[Line], join: float = 2.5, min_turn_deg: float = 25.0, max_err: float = 1.5
) -> tuple[list[ArcPrim], set[int]]:
    """Cadenas de segmentos que giran de a poco → arcos de circunferencia."""
    n = len(lines)
    ends: dict[tuple[int, int], list[tuple[int, int]]] = {}

    def key(p: Px) -> tuple[int, int]:
        return (int(p[0] // join), int(p[1] // join))

    for i, ln in enumerate(lines):
        for e, p in enumerate((ln.p1, ln.p2)):
            kx, ky = key(p)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    ends.setdefault((kx + dx, ky + dy), []).append((i, e))

    def neighbors(i: int, e: int) -> list[tuple[int, int]]:
        p = lines[i].p1 if e == 0 else lines[i].p2
        out = []
        for j, f in ends.get(key(p), []):
            if j == i:
                continue
            q = lines[j].p1 if f == 0 else lines[j].p2
            if math.dist(p, q) <= join:
                out.append((j, f))
        return out

    def turn(i: int, j: int) -> float:
        d = abs(lines[i].angle - lines[j].angle) % 180
        return min(d, 180 - d)

    used: set[int] = set()
    arcs: list[ArcPrim] = []
    for start in range(n):
        if start in used or lines[start].length > 60:
            continue
        chain = [start]
        seen = {start}
        # crecer por ambos extremos mientras el giro sea suave
        for e0 in (1, 0):
            cur, ce = start, e0
            while True:
                cand = [
                    (j, f)
                    for j, f in neighbors(cur, ce)
                    if j not in seen
                    and j not in used
                    and 2 <= turn(cur, j) <= 35
                    and lines[j].length <= 60
                ]
                if len(cand) != 1:
                    break
                j, f = cand[0]
                seen.add(j)
                if e0 == 1:
                    chain.append(j)
                else:
                    chain.insert(0, j)
                cur, ce = j, 1 - f
        if len(chain) < 3:
            continue
        lengths = sorted(lines[i].length for i in chain)
        median = lengths[len(lengths) // 2]
        if lengths[-1] > 2.5 * median:
            continue  # un tramo recto largo entre dos cortos es una esquina, no un arco
        pts = [p for i in chain for p in (lines[i].p1, lines[i].p2)]
        fit = _fit_circle(pts)
        if fit is None:
            continue
        cx, cy, r, err = fit
        if err > max_err or r < 5 or lengths[-1] > 0.6 * r:
            continue
        angs = sorted(math.atan2(y - cy, x - cx) for x, y in pts)
        gaps = [b - a for a, b in itertools.pairwise(angs)] + [angs[0] + 2 * math.pi - angs[-1]]
        k = int(np.argmax(gaps))
        start_ang = angs[(k + 1) % len(angs)]
        sweep = 2 * math.pi - gaps[k]
        if math.degrees(sweep) < min_turn_deg:
            continue
        arcs.append(ArcPrim(cx, cy, r, start_ang, sweep))
        used.update(chain)
    return arcs, used


def _fit_circle(pts: list[Px]) -> tuple[float, float, float, float] | None:
    if len(pts) < 5:
        return None
    a = np.array([[2 * x, 2 * y, 1.0] for x, y in pts])
    b = np.array([x * x + y * y for x, y in pts])
    sol, *_ = np.linalg.lstsq(a, b, rcond=None)
    cx, cy, c = sol
    r2 = c + cx * cx + cy * cy
    if r2 <= 0:
        return None
    r = math.sqrt(r2)
    err = max(abs(math.hypot(x - cx, y - cy) - r) for x, y in pts)
    return float(cx), float(cy), r, float(err)


# ----------------------------------------------------------------------------- todo junto


@dataclass
class Vectorized:
    faces: list[Line]  # caras de muros rellenos
    strokes: list[Line]  # ejes de trazos finos
    arcs: list[ArcPrim]
    solids: list[npt.NDArray[np.int32]]
    stroke_px: float


def _strokes(thin: Img) -> list[Line]:
    # segmentos sobre el ESQUELETO: los dos bordes de una línea de 1 px están a ~1 px, así
    # que colapsarlos no puede fundir las dos caras de un tabique delgado
    raw = trace_skeleton(skeleton(thin))
    return collapse_strokes(raw, 1.0)


def vectorize(ink: Img) -> Vectorized:
    layers = split_ink(ink)
    thick, thin = layers.thick, layers.thin
    strokes = merge_collinear(_strokes(thin), gap=max(2.0, 1.5 * layers.stroke_px))
    # achurado: las rayas unen las dos caras del muro y lo parten en trocitos; la zona
    # achurada se rellena y pasa a ser un muro relleno (sus contornos son las caras)
    hatch = hatch_indices(strokes, max_len=max(25.0, 10 * layers.stroke_px))
    if len(hatch) >= 12:
        region = hatch_region(ink.shape, [strokes[i] for i in hatch])
        filled = as_u8(cv2.bitwise_and(ink, cv2.dilate(region, np.ones((5, 5), np.uint8))))
        filled = as_u8(cv2.bitwise_or(filled, region))
        close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        thick = as_u8(cv2.bitwise_or(thick, cv2.morphologyEx(filled, cv2.MORPH_CLOSE, close)))
        grown = cv2.dilate(thick, np.ones((3, 3), np.uint8))
        thin = as_u8(cv2.bitwise_and(thin, cv2.bitwise_not(grown)))
        strokes = merge_collinear(_strokes(thin), gap=max(2.0, 1.5 * layers.stroke_px))
    faces = merge_collinear(thick_faces(thick), gap=2.0)
    arcs, used = arcs_from_segments(strokes)
    # un tramo de "arco" alineado con una dirección dominante del dibujo puede ser la
    # cara de un muro con ganchos del esqueleto en sus puntas: se conserva también
    axes = _dominant_axes(strokes)
    strokes = [
        s
        for i, s in enumerate(strokes)
        if i not in used or (s.length >= 10 and any(_adiff(s.angle, a) <= 3 for a in axes))
    ]
    face_arcs, used_f = arcs_from_segments(faces, join=1.5)
    faces = [f for i, f in enumerate(faces) if i not in used_f]
    arcs = collapse_arcs(arcs, layers.stroke_px)
    return Vectorized(faces, strokes, [*arcs, *face_arcs], layers.small_solids, layers.stroke_px)


def _adiff(a: float, b: float) -> float:
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def _dominant_axes(lines: list[Line]) -> list[float]:
    """Ángulos (de 0 a 180) con más largo acumulado: las direcciones de los muros."""
    hist = np.zeros(180)
    for ln in lines:
        hist[round(ln.angle) % 180] += ln.length
    if hist.sum() <= 0:
        return []
    out: list[float] = []
    for k in np.argsort(-hist):
        if hist[k] < 0.1 * hist.max():
            break
        if all(_adiff(float(k), a) > 5 for a in out):
            out.append(float(k))
    return out


def collapse_arcs(arcs: list[ArcPrim], width: float) -> list[ArcPrim]:
    """Los dos bordes de un trazo fino curvo (arcos concéntricos a ≤ ancho + 1,5 px) → uno."""
    out: list[ArcPrim] = []
    for a in sorted(arcs, key=lambda a: -a.length):
        for k, o in enumerate(out):
            if math.dist((a.cx, a.cy), (o.cx, o.cy)) > width + 2 or abs(a.r - o.r) > width + 1.5:
                continue
            lo_a, hi_a = a.interval()
            lo_o, hi_o = o.interval()
            ov = min(hi_a, hi_o) - max(lo_a, lo_o)
            if ov < 0.5 * min(hi_a - lo_a, hi_o - lo_o):
                continue
            r = (a.r + o.r) / 2
            out[k] = ArcPrim(o.cx, o.cy, r, o.start, o.sweep, o.layer)
            break
        else:
            out.append(a)
    return out

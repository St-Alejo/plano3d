"""Lector de PDF VECTORIAL (pdfplumber, MIT) → ``Drawing`` en metros.

Un PDF de arquitectura impreso desde CAD conserva la geometría exacta, pero en puntos
tipográficos y sin entidades de cota. La escala sale, por orden de confianza:
1. de las COTAS: cada texto de longitud ("3,45", "345", "3⁴⁵") junto a una línea paralela
   da un par (puntos, metros); la razón con más pares coincidentes (al 0,5 %) gana;
2. del rótulo ``ESC 1:N`` (si no coincide con las cotas, mandan las cotas: la copia pudo
   imprimirse reducida);
3. si no hay nada: 1:50 supuesto, y las medidas quedan como INFERIDAS.
Las líneas de cota (y sus marcas) se retiran antes de buscar muros.
"""

from __future__ import annotations

import io
import itertools
import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import pdfplumber

from plano3d.domain.plan_text import parse_length, parse_scale
from plano3d.domain.scale_fit import ScalePair, fit_scale
from plano3d.infrastructure.vector.primitives import (
    ArcPrim,
    Closed,
    DimPrim,
    Drawing,
    Line,
    Text,
)

M_PER_PT = 0.0254 / 72
DEFAULT_SCALE = 50
MIN_VECTOR_OBJECTS = 40


class PdfReadError(ValueError):
    pass


def is_vector_pdf(data: bytes) -> bool:
    """¿La primera página trae dibujo vectorial (y no solo una imagen escaneada)?"""
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            if not pdf.pages:
                return False
            page = pdf.pages[0]
            n = len(page.lines) + len(page.rects) + len(page.curves)
            return n >= MIN_VECTOR_OBJECTS
    except Exception:
        return False


# ----------------------------------------------------------------------------- textos


@dataclass
class _Phrase:
    text: str
    x: float  # centro, puntos con y hacia abajo
    y: float
    size: float
    angle: float  # dirección de escritura (rad, y abajo)


def group_chars(chars: list[dict[str, Any]]) -> list[_Phrase]:
    """Arma frases a partir de caracteres sueltos usando su matriz (cualquier rotación).

    Para cada carácter: dirección de escritura (de la matriz), extensión a lo largo de
    ella y altura de letra (extensión perpendicular). Dos caracteres seguidos están en
    la misma frase si comparten línea base y el hueco entre bordes es menor que una
    altura de letra; un hueco de más de un tercio de la altura es un espacio.
    """
    items = []
    for c in chars:
        a, b = float(c["matrix"][0]), float(c["matrix"][1])
        n = math.hypot(a, b) or 1.0
        d = (a / n, -b / n)  # dirección en coordenadas con y hacia abajo
        w = float(c["x1"]) - float(c["x0"])
        h = float(c["bottom"]) - float(c["top"])
        along = abs(w * d[0]) + abs(h * d[1])
        height = max(abs(w * d[1]) + abs(h * d[0]), 1e-3)
        cx = (float(c["x0"]) + float(c["x1"])) / 2
        cy = (float(c["top"]) + float(c["bottom"])) / 2
        items.append((d, cx, cy, along, height, str(c["text"])))
    items.sort(
        key=lambda it: (
            round(math.atan2(it[0][1], it[0][0]), 2),
            it[1] * it[0][0] + it[2] * it[0][1],
        )
    )
    phrases: list[list[tuple[tuple[float, float], float, float, float, float, str]]] = []
    for it in items:
        d, cx, cy, along, height, _ = it
        placed = False
        for ph in reversed(phrases):
            last = ph[-1]
            if abs(last[0][0] - d[0]) > 0.05 or abs(last[0][1] - d[1]) > 0.05:
                continue
            rel = (cx - last[1], cy - last[2])
            dist = rel[0] * d[0] + rel[1] * d[1]
            perp = abs(-rel[0] * d[1] + rel[1] * d[0])
            hgt = max(height, last[4])
            edge_gap = dist - (along + last[3]) / 2
            if perp <= 0.45 * hgt and -0.3 * hgt <= edge_gap <= 1.0 * hgt:
                ph.append(it)
                placed = True
                break
        if not placed:
            phrases.append([it])
    out = []
    for ph in phrases:
        d = ph[0][0]
        text = ""
        for k, it in enumerate(ph):
            if k:
                prev = ph[k - 1]
                dist = (it[1] - prev[1]) * d[0] + (it[2] - prev[2]) * d[1]
                if dist - (it[3] + prev[3]) / 2 > 0.33 * max(it[4], prev[4]):
                    text += " "
            text += it[5]
        xs = [it[1] for it in ph]
        ys = [it[2] for it in ph]
        size = float(np.median([it[4] for it in ph]))
        out.append(
            _Phrase(
                text.strip(), sum(xs) / len(xs), sum(ys) / len(ys), size, math.atan2(d[1], d[0])
            )
        )
    return [p for p in out if p.text]


# ----------------------------------------------------------------------------- geometría


def _bezier(
    p0: tuple[float, float], p1: Any, p2: Any, p3: Any, n: int = 8
) -> list[tuple[float, float]]:
    pts = []
    for i in range(1, n + 1):
        t = i / n
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def _fit_circle(pts: list[tuple[float, float]]) -> tuple[float, float, float, float] | None:
    """Ajuste algebraico (Kasa): (cx, cy, r, error relativo máximo)."""
    if len(pts) < 5:
        return None
    a = np.array([[2 * x, 2 * y, 1.0] for x, y in pts])
    b = np.array([x * x + y * y for x, y in pts])
    try:
        sol, *_ = np.linalg.lstsq(a, b, rcond=None)
    except np.linalg.LinAlgError:
        return None
    cx, cy, c = sol
    r2 = c + cx * cx + cy * cy
    if r2 <= 0:
        return None
    r = math.sqrt(r2)
    err = max(abs(math.hypot(x - cx, y - cy) - r) for x, y in pts) / r
    return float(cx), float(cy), r, err


def _curve_to_prims(
    curve: dict[str, Any], page_h: float
) -> tuple[list[ArcPrim], list[tuple[tuple[float, float], tuple[float, float]]]]:
    """Una curva del PDF → arcos (tramos circulares) y tramos rectos. Puntos con y abajo.

    Un mismo trazado puede mezclar rectas y Bézier (la hoja de una puerta y su arco de
    giro salen juntos desde CAD): cada racha de Bézier se ajusta por separado.
    """
    path = curve.get("path") or []
    arcs: list[ArcPrim] = []
    segs: list[tuple[tuple[float, float], tuple[float, float]]] = []
    run: list[tuple[float, float]] = []  # racha de Bézier en curso
    cur: tuple[float, float] | None = None

    def flip(p: Any) -> tuple[float, float]:
        # pdfplumber ya entrega el trazado con y hacia abajo ("top"), como las líneas
        return (float(p[0]), float(p[1]))

    def close_run() -> None:
        if len(run) >= 3:
            fit = _fit_circle(run)
            if fit and fit[3] < 0.01:
                cx, cy, r, _ = fit
                angs = np.unwrap([math.atan2(y - cy, x - cx) for x, y in run])
                arcs.append(ArcPrim(cx, cy, r, float(angs[0]), float(angs[-1] - angs[0])))
            else:
                segs.extend(itertools.pairwise(run))
        run.clear()

    for cmd in path:
        op = cmd[0]
        if op == "m":
            close_run()
            cur = flip(cmd[1])
        elif op == "l" and cur is not None:
            close_run()
            nxt = flip(cmd[1])
            segs.append((cur, nxt))
            cur = nxt
        elif op == "c" and cur is not None:
            if not run:
                run.append(cur)
            new = _bezier(cur, flip(cmd[1]), flip(cmd[2]), flip(cmd[3]))
            run.extend(new)
            cur = new[-1]
        elif op == "h" and cur is not None:
            close_run()
    close_run()
    if not path and len(curve.get("pts") or []) >= 2:
        pts = [flip(p) for p in curve["pts"]]
        segs.extend(itertools.pairwise(pts))
    return arcs, segs


# ----------------------------------------------------------------------------- escala


@dataclass
class _DimCandidate:
    line: int
    length_pt: float
    meters: float
    text: _Phrase


def _dimension_pairs(lines: list[Line], phrases: list[_Phrase]) -> list[_DimCandidate]:
    out = []
    for ph in phrases:
        parsed = parse_length(ph.text)
        if parsed is None or parsed.meters <= 0.05:
            continue
        d = (math.cos(ph.angle), math.sin(ph.angle))
        for i, ln in enumerate(lines):
            if ln.length < 3 * ph.size:
                continue
            u = ln.direction
            if abs(u[0] * d[1] - u[1] * d[0]) > 0.02:  # no paralela al texto
                continue
            mx, my = (ln.x1 + ln.x2) / 2, (ln.y1 + ln.y2) / 2
            rel = (ph.x - mx, ph.y - my)
            along = abs(rel[0] * u[0] + rel[1] * u[1])
            perp = abs(-rel[0] * u[1] + rel[1] * u[0])
            if perp <= 2.5 * ph.size and along <= 0.25 * ln.length:
                out.append(_DimCandidate(i, ln.length, parsed.meters, ph))
    return out


def scale_from_dimensions(cands: list[_DimCandidate]) -> tuple[float, list[_DimCandidate]]:
    """RANSAC de la razón metros/punto (ver ``domain.scale_fit``), al 0,5 %."""
    pairs = [ScalePair(c.length_pt, c.meters, id(c.text), c.line) for c in cands]
    fit = fit_scale(pairs)
    if fit is None:
        return 0.0, []
    return fit.meters_per_unit, [cands[i] for i in fit.inliers]


# ----------------------------------------------------------------------------- plumas

#: la pluma de muros debe sumar al menos esto (m) y ser claramente más gruesa que el resto
MIN_WALL_PEN_LENGTH_M = 15.0
MIN_PEN_RATIO = 1.6


def _pen(obj: dict[str, Any]) -> str:
    """Grosor de trazo como 'capa' (en el PDF de CAD cada capa sale con su pluma)."""
    return f"pen:{float(obj.get('linewidth') or 0.0):.2f}"


def _pen_width(pen: str) -> float:
    return float(pen.split(":", 1)[1]) if pen.startswith("pen:") else 0.0


def wall_pen_set(lines: list[Line], mpt: float) -> set[str] | None:
    """Plumas de muro: las más gruesas si se distinguen del resto; ``None`` si no se puede.

    En un PDF impreso desde CAD los muros cortados llevan la pluma más gruesa y el
    mobiliario, las escaleras, los aparatos y las cotas plumas finas. Si todo viene con el
    mismo grosor (o la pluma gruesa es apenas un marco) no se filtra nada.
    """
    total: dict[str, float] = {}
    for ln in lines:
        total[ln.layer] = total.get(ln.layer, 0.0) + ln.length * mpt
    widths = sorted({_pen_width(p) for p in total if _pen_width(p) > 0}, reverse=True)
    if len(widths) < 2:
        return None
    for k in range(1, len(widths)):
        heavy, light = widths[k - 1], widths[k]
        if heavy < MIN_PEN_RATIO * light:
            continue
        pens = {p for p in total if _pen_width(p) >= heavy}
        if sum(total[p] for p in pens) >= MIN_WALL_PEN_LENGTH_M:
            return pens
        return None
    return None


#: separación (m) entre las dos caras gruesas de un muro
FACE_GAP = (0.05, 0.40)
DEFAULT_THICKNESS = 0.12
#: un tramo de una sola línea es de fachada si nada grueso lo tapa hacia afuera
ENVELOPE_REACH = 1.5


def _overlap(a: Line, b: Line) -> float:
    """Fracción de ``b`` que cae sobre la proyección de ``a`` (ambas paralelas)."""
    u = a.direction
    ta = sorted(((p[0] - a.x1) * u[0] + (p[1] - a.y1) * u[1]) for p in (a.p1, a.p2))
    tb = sorted(((p[0] - a.x1) * u[0] + (p[1] - a.y1) * u[1]) for p in (b.p1, b.p2))
    inter = min(ta[1], tb[1]) - max(ta[0], tb[0])
    return max(0.0, inter) / max(b.length, 1e-9)


def _offset(a: Line, b: Line) -> float:
    """Distancia con signo del punto medio de ``b`` a la recta de ``a``."""
    u = a.direction
    mx, my = (b.x1 + b.x2) / 2 - a.x1, (b.y1 + b.y2) / 2 - a.y1
    return -mx * u[1] + my * u[0]


def _parallel(a: Line, b: Line) -> bool:
    diff = abs(a.angle - b.angle) % 180.0
    return min(diff, 180.0 - diff) < 1.0


def single_line_faces(heavy: list[Line]) -> list[Line]:
    """Cara exterior de los muros de fachada dibujados con UNA sola línea gruesa.

    Muchos planos dibujan la fachada o la medianera como una línea (la cara interior) y
    las cotas pasan por fuera. Para cada tramo grueso sin pareja que está en el borde del
    edificio se agrega la otra cara hacia afuera, con el espesor típico del mismo plano
    (la mediana de las parejas gruesas).
    """
    if not heavy:
        return []
    lo, hi = FACE_GAP
    gaps: list[float] = []
    unpaired: list[Line] = []
    for a in heavy:
        mates = [
            abs(_offset(a, b))
            for b in heavy
            if b is not a
            and _parallel(a, b)
            and lo <= abs(_offset(a, b)) <= hi
            and max(_overlap(a, b), _overlap(b, a)) > 0.5
        ]
        if mates:
            gaps.append(min(mates))
        elif a.length >= 0.3:
            unpaired.append(a)
    t = float(np.median(gaps)) if gaps else DEFAULT_THICKNESS
    cx = sum((ln.x1 + ln.x2) / 2 for ln in heavy) / len(heavy)
    cy = sum((ln.y1 + ln.y2) / 2 for ln in heavy) / len(heavy)
    out: list[Line] = []
    for a in unpaired:
        side = -1.0 if _offset(a, Line(cx, cy, cx, cy)) > 0 else 1.0  # hacia afuera
        covered = any(
            b is not a
            and _parallel(a, b)
            and 0 < side * _offset(a, b) <= ENVELOPE_REACH
            and _overlap(a, b) + _overlap(b, a) > 0.3
            for b in heavy
        )
        if covered:
            continue
        nx, ny = -a.direction[1] * side * t, a.direction[0] * side * t
        out.append(Line(a.x1 + nx, a.y1 + ny, a.x2 + nx, a.y2 + ny, a.layer))
    return out


def hatched_columns(
    rings: list[tuple[tuple[float, float], ...]], lines: list[Line], mpt: float
) -> list[Closed]:
    """Rectángulos chicos casi cuadrados con rayado adentro = columnas (en puntos)."""
    out = []
    for ring in rings:
        (x0, t), (x1, _), (_, b), _ = ring
        w, h = (x1 - x0) * mpt, (b - t) * mpt
        if not (min(w, h) >= 0.15 and max(w, h) <= 0.8 and max(w, h) <= 1.6 * min(w, h)):
            continue
        inside = sum(
            1
            for ln in lines
            if x0 < (ln.x1 + ln.x2) / 2 < x1
            and t < (ln.y1 + ln.y2) / 2 < b
            and ln.length < 0.98 * max(x1 - x0, b - t) * 1.5
            and abs(ln.direction[0] * ln.direction[1]) > 0.0  # diagonal
        )
        if inside >= 3:
            out.append(Closed(ring, True))
    return out


# ----------------------------------------------------------------------------- lectura


def read_pdf(data: bytes, page_index: int = 0) -> Drawing:
    try:
        pdf = pdfplumber.open(io.BytesIO(data))
    except Exception as exc:
        raise PdfReadError(f"No se pudo leer el PDF: {exc}") from exc
    with pdf:
        if page_index >= len(pdf.pages):
            raise PdfReadError("El PDF no tiene esa página")
        page = pdf.pages[page_index]
        page_h = float(page.height)
        raw: list[Line] = []
        arcs: list[ArcPrim] = []
        closed: list[Closed] = []
        rings: list[tuple[tuple[float, float], ...]] = []
        for obj in page.lines:
            pts = obj["pts"]
            pen = _pen(obj)
            for p, q in itertools.pairwise(pts):
                raw.append(Line(float(p[0]), float(p[1]), float(q[0]), float(q[1]), pen))
        for rect in page.rects:
            x0, x1, t, b = (
                float(rect["x0"]),
                float(rect["x1"]),
                float(rect["top"]),
                float(rect["bottom"]),
            )
            ring = ((x0, t), (x1, t), (x1, b), (x0, b))
            if rect.get("fill") and max(x1 - x0, b - t) < 100:
                closed.append(Closed(ring, True))
                continue
            rings.append(ring)
            for p, q in zip(ring, (*ring[1:], ring[0]), strict=True):
                raw.append(Line(p[0], p[1], q[0], q[1], _pen(rect)))
        for curve in page.curves:
            if curve.get("fill") and not curve.get("stroke"):
                pts = [(float(p[0]), float(p[1])) for p in curve["pts"]]
                if len(pts) >= 3:
                    closed.append(Closed(tuple(pts), True))
                continue
            a, segs = _curve_to_prims(curve, page_h)
            pen = _pen(curve)
            arcs += [ArcPrim(x.cx, x.cy, x.r, x.start, x.sweep, pen) for x in a]
            raw += [Line(p[0], p[1], q[0], q[1], pen) for p, q in segs]
        phrases = group_chars(page.chars)

    # escala: cotas (RANSAC) y rótulo
    label_den = next((den for p in phrases if (den := parse_scale(p.text)) is not None), None)
    label_ratio = label_den * M_PER_PT if label_den else None
    # una cara de muro que la cota de al lado mide justo SÍ sirve para la escala, pero no
    # se borra como si fuera la línea de la cota
    wall_pens = wall_pen_set(raw, label_ratio or DEFAULT_SCALE * M_PER_PT)
    is_wall = [wall_pens is not None and ln.layer in wall_pens for ln in raw]
    cands = _dimension_pairs(raw, phrases)
    ratio, inliers = scale_from_dimensions(cands)
    exact = True
    if len(inliers) >= 3:
        mpt = ratio
    elif label_ratio is not None:
        mpt = label_ratio
        inliers = [c for c in cands if abs(c.meters / c.length_pt / mpt - 1) < 0.005]
    else:
        mpt = DEFAULT_SCALE * M_PER_PT
        exact = False
        inliers = []

    dim_lines = {c.line for c in inliers if not is_wall[c.line]}
    # marcas y líneas de extensión: segmentos cortos que tocan los extremos de una cota
    ends = [p for i in dim_lines for p in (raw[i].p1, raw[i].p2)]
    tick_max = 0.45 / mpt
    drop = set(dim_lines)
    for i, ln in enumerate(raw):
        if i in drop or ln.length > tick_max or is_wall[i]:
            continue
        for e in ends:
            mid = ((ln.x1 + ln.x2) / 2, (ln.y1 + ln.y2) / 2)
            if math.dist(mid, e) <= 0.6 * ln.length + 1e-6:
                drop.add(i)
                break
    dim_texts = {id(c.text) for c in inliers}

    def m(p: tuple[float, float]) -> tuple[float, float]:
        return (p[0] * mpt, p[1] * mpt)

    kept = [ln for i, ln in enumerate(raw) if i not in drop]
    closed += hatched_columns(rings, kept, mpt)

    def scaled(ln: Line) -> Line:
        return Line(ln.x1 * mpt, ln.y1 * mpt, ln.x2 * mpt, ln.y2 * mpt, ln.layer)

    def scaled_arc(a: ArcPrim) -> ArcPrim:
        return ArcPrim(a.cx * mpt, a.cy * mpt, a.r * mpt, a.start, a.sweep, a.layer)

    d = Drawing(exact_scale=exact)
    if wall_pens is None:
        d.lines = [scaled(ln) for ln in kept]
        d.arcs = [scaled_arc(a) for a in arcs]
    else:
        # muros = pluma gruesa; el resto (mobiliario, escaleras, aberturas) es evidencia
        heavy = [scaled(ln) for ln in kept if ln.layer in wall_pens]
        thin = [scaled(ln) for ln in kept if ln.layer not in wall_pens]
        d.lines = heavy + single_line_faces(heavy)
        d.detail_lines = thin
        d.arcs = [scaled_arc(a) for a in arcs if a.layer in wall_pens]
        d.detail_arcs = [scaled_arc(a) for a in arcs if a.layer not in wall_pens]
    d.closed = [Closed(tuple(m(p) for p in c.points), c.filled) for c in closed]
    d.texts = [
        Text(p.x * mpt, p.y * mpt, p.text, p.size * mpt, p.angle)
        for p in phrases
        if id(p) not in dim_texts
    ]
    for c in inliers:
        ln = raw[c.line]
        horizontal = abs(ln.direction[1]) < 0.02
        vertical = abs(ln.direction[0]) < 0.02
        axis = "horizontal" if horizontal else ("vertical" if vertical else "aligned")
        d.dims.append(DimPrim(m(ln.p1), m(ln.p2), c.meters, c.text.text, axis))
    return d

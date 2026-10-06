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
    """Una curva del PDF → arco (si es circular) o tramos rectos. Puntos con y abajo."""
    path = curve.get("path") or []
    pts: list[tuple[float, float]] = []
    cur: tuple[float, float] | None = None
    has_bezier = False

    def flip(p: Any) -> tuple[float, float]:
        # pdfplumber ya entrega el trazado con y hacia abajo ("top"), como las líneas
        return (float(p[0]), float(p[1]))

    for cmd in path:
        op = cmd[0]
        if op == "m" or (op == "l" and cur is not None):
            cur = flip(cmd[1])
            pts.append(cur)
        elif op == "c" and cur is not None:
            has_bezier = True
            new = _bezier(cur, flip(cmd[1]), flip(cmd[2]), flip(cmd[3]))
            pts += new
            cur = new[-1]
    if len(pts) < 2:
        return [], []
    if has_bezier:
        fit = _fit_circle(pts)
        if fit and fit[3] < 0.01:
            cx, cy, r, _ = fit
            angs = np.unwrap([math.atan2(y - cy, x - cx) for x, y in pts])
            return [ArcPrim(cx, cy, r, float(angs[0]), float(angs[-1] - angs[0]))], []
    return [], list(itertools.pairwise(pts))


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
        for obj in page.lines:
            pts = obj["pts"]
            for p, q in itertools.pairwise(pts):
                raw.append(Line(float(p[0]), float(p[1]), float(q[0]), float(q[1])))
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
            for p, q in zip(ring, (*ring[1:], ring[0]), strict=True):
                raw.append(Line(p[0], p[1], q[0], q[1]))
        for curve in page.curves:
            if curve.get("fill") and not curve.get("stroke"):
                pts = [(float(p[0]), float(p[1])) for p in curve["pts"]]
                if len(pts) >= 3:
                    closed.append(Closed(tuple(pts), True))
                continue
            a, segs = _curve_to_prims(curve, page_h)
            arcs += a
            raw += [Line(p[0], p[1], q[0], q[1]) for p, q in segs]
        phrases = group_chars(page.chars)

    # escala: cotas (RANSAC) y rótulo
    cands = _dimension_pairs(raw, phrases)
    ratio, inliers = scale_from_dimensions(cands)
    label_den = next((den for p in phrases if (den := parse_scale(p.text)) is not None), None)
    label_ratio = label_den * M_PER_PT if label_den else None
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

    dim_lines = {c.line for c in inliers}
    # marcas y líneas de extensión: segmentos cortos que tocan los extremos de una cota
    ends = [p for i in dim_lines for p in (raw[i].p1, raw[i].p2)]
    tick_max = 0.45 / mpt
    drop = set(dim_lines)
    for i, ln in enumerate(raw):
        if i in drop or ln.length > tick_max:
            continue
        for e in ends:
            mid = ((ln.x1 + ln.x2) / 2, (ln.y1 + ln.y2) / 2)
            if math.dist(mid, e) <= 0.6 * ln.length + 1e-6:
                drop.add(i)
                break
    dim_texts = {id(c.text) for c in inliers}

    def m(p: tuple[float, float]) -> tuple[float, float]:
        return (p[0] * mpt, p[1] * mpt)

    d = Drawing(exact_scale=exact)
    d.lines = [
        Line(ln.x1 * mpt, ln.y1 * mpt, ln.x2 * mpt, ln.y2 * mpt)
        for i, ln in enumerate(raw)
        if i not in drop
    ]
    d.arcs = [ArcPrim(a.cx * mpt, a.cy * mpt, a.r * mpt, a.start, a.sweep) for a in arcs]
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

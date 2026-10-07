"""Aberturas: huecos entre tramos colineales del mismo muro → puertas o ventanas.

En un plano, una puerta es un hueco en el muro (con un arco de giro fuera del
muro); una ventana es un hueco cruzado por líneas finas paralelas al muro. Por
eso se mira cuánta tinta fina hay DENTRO de la banda del muro en el hueco.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, replace

import cv2
import numpy as np

from plano3d.application.pipeline import PipelineStage
from plano3d.infrastructure.cv.context import CVContext, Img, PxOpening, Segment, as_u8
from plano3d.infrastructure.cv.stages.room_names import text_mask
from plano3d.infrastructure.cv.stages.scale import DOOR_SCALE_CONFIDENCE, scale_from_doors

MIN_OPENING_M = 0.35
MAX_OPENING_M = 2.6
ANGLE_TOL_DEG = 4.0
WINDOW_INK_RATIO = 0.18


def _angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


@dataclass
class _Piece:
    start: float
    end: float
    offset: float  # desplazamiento normal de la línea central
    thickness: float
    confidence: float
    openings: list[PxOpening]


def _group_collinear(segments: list[Segment], t: float) -> list[tuple[float, list[Segment]]]:
    """Agrupa por dirección y luego por recta (offset normal)."""
    by_angle: list[tuple[float, list[Segment]]] = []
    for s in sorted(segments, key=lambda s: s.angle):
        for ang, group in by_angle:
            if _angle_diff(ang, s.angle) < ANGLE_TOL_DEG:
                group.append(s)
                break
        else:
            by_angle.append((s.angle, [s]))

    lines: list[tuple[float, list[Segment]]] = []
    for ang, group in by_angle:
        nx, ny = -math.sin(math.radians(ang)), math.cos(math.radians(ang))
        keyed = sorted(group, key=lambda s: nx * (s.x1 + s.x2) / 2 + ny * (s.y1 + s.y2) / 2)
        current: list[Segment] = []
        last_c = None
        for s in keyed:
            c = nx * (s.x1 + s.x2) / 2 + ny * (s.y1 + s.y2) / 2
            if last_c is not None and abs(c - last_c) > 0.6 * t:
                lines.append((ang, current))
                current = []
            current.append(s)
            last_c = c
        if current:
            lines.append((ang, current))
    return lines


SLIDING_EVIDENCE = 0.6


def _row_coverage(
    ink: Img,
    a: tuple[float, float],
    u: tuple[float, float],
    n: tuple[float, float],
    off: float,
    t0: float,
    t1: float,
) -> float:
    """Fracción de puntos con tinta sobre la recta paralela al muro desplazada ``off``."""
    steps = max(6, int(t1 - t0) // 2)
    hits = 0
    for s in range(steps + 1):
        f = t0 + (t1 - t0) * s / steps
        hits += _ink_near(ink, a[0] + u[0] * f + n[0] * off, a[1] + u[1] * f + n[1] * off, 0)
    return hits / (steps + 1)


def sliding_door_evidence(
    ink: Img, a: tuple[float, float], b: tuple[float, float], thickness: float
) -> float:
    """Firma de una puerta corrediza: dos hojas desfasadas en el espesor del muro.

    Cada hoja ocupa ~la mitad del vano a una profundidad distinta, así que hay una línea
    que cubre solo la mitad izquierda y otra que cubre solo la derecha. Una ventana (también
    la corrediza) tiene alféizar: alguna línea cruza el vano entero, y entonces no cuenta.
    """
    length = math.dist(a, b)
    if length < 1:
        return 0.0
    u = ((b[0] - a[0]) / length, (b[1] - a[1]) / length)
    n = (-u[1], u[0])
    rows = range(-round(thickness * 0.6), round(thickness * 0.6) + 1)
    left = [_row_coverage(ink, a, u, n, r, length * 0.08, length * 0.42) for r in rows]
    right = [_row_coverage(ink, a, u, n, r, length * 0.58, length * 0.92) for r in rows]
    if max(min(lv, rv) for lv, rv in zip(left, right, strict=True)) >= 0.5:
        return 0.0  # una línea cruza todo el vano: alféizar de ventana
    only_left = max(lv - rv for lv, rv in zip(left, right, strict=True))
    only_right = max(rv - lv for lv, rv in zip(left, right, strict=True))
    return min(only_left, only_right)


def _operation(
    kind: str, ink: Img, a: tuple[float, float], b: tuple[float, float], thickness: float
) -> str | None:
    if kind == "door" and sliding_door_evidence(ink, a, b, thickness) >= SLIDING_EVIDENCE:
        return "sliding"
    return None


def _has_swing(ink: Img, a: tuple[float, float], b: tuple[float, float]) -> bool:
    width = math.dist(a, b)
    if width < 1:
        return False
    u = ((b[0] - a[0]) / width, (b[1] - a[1]) / width)
    swing = max(
        door_swing_evidence(ink, a, u, width),
        door_swing_evidence(ink, b, (-u[0], -u[1]), width),
    )
    return swing >= SWING_EVIDENCE


def classify_gap(
    ink: Img, a: tuple[float, float], b: tuple[float, float], thickness: float
) -> tuple[str, float]:
    """Devuelve (tipo, confianza) mirando la tinta fina dentro de la banda del muro."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    if length < 1:
        return "door", 0.4
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux
    h = thickness * 0.4
    shrink = min(length * 0.15, thickness)  # evita las jambas
    pa = (a[0] + ux * shrink, a[1] + uy * shrink)
    pb = (b[0] - ux * shrink, b[1] - uy * shrink)
    poly = np.array(
        [
            [pa[0] + nx * h, pa[1] + ny * h],
            [pb[0] + nx * h, pb[1] + ny * h],
            [pb[0] - nx * h, pb[1] - ny * h],
            [pa[0] - nx * h, pa[1] - ny * h],
        ]
    )
    band = np.zeros_like(ink)
    cv2.fillPoly(band, [np.round(poly).astype(np.int32)], 255)
    area = int((band > 0).sum())
    if area == 0:
        return "door", 0.4
    ratio = float(((ink > 0) & (band > 0)).sum()) / area
    if sliding_door_evidence(ink, a, b, thickness) >= SLIDING_EVIDENCE:
        return "door", 0.8
    if ratio >= WINDOW_INK_RATIO:
        return "window", min(0.9, 0.5 + ratio)
    return "door", min(0.9, 0.9 - ratio * 2)


Pt = tuple[float, float]


def envelope_test(segments: list[Segment], t: float) -> Callable[[Pt, Pt], bool]:
    """Devuelve una prueba: ¿el vano a-b separa el exterior del interior del edificio?

    El exterior se aproxima por lo que queda fuera del casco convexo de los muros.
    """
    pts = np.array([p for w in segments for p in ((w.x1, w.y1), (w.x2, w.y2))], np.float32)
    hull = cv2.convexHull(pts) if len(pts) >= 3 else None

    def test(a: Pt, b: Pt) -> bool:
        if hull is None:
            return False
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        dx, dy = b[0] - a[0], b[1] - a[1]
        n = math.hypot(dx, dy) or 1.0
        px, py = -dy / n * 2 * t, dx / n * 2 * t
        side1 = cv2.pointPolygonTest(hull, (mx + px, my + py), False) >= 0
        side2 = cv2.pointPolygonTest(hull, (mx - px, my - py), False) >= 0
        return side1 != side2

    return test


def thin_ink(ink: Img, segments: list[Segment]) -> Img:
    """Tinta sin los muros: la evidencia de puertas y ventanas (arcos, hojas, líneas) es fina,
    y muestreada junto a un muro caería dentro de él."""
    walls = np.zeros_like(ink)
    for w in segments:
        # rectángulo exacto del muro (sin puntas redondeadas): la hoja de una puerta suele ir
        # pegada a la cara del muro y no debe quedar tapada
        dx, dy = w.direction
        # +1,5 px: el borde dibujado (sombra, antialias) suele exceder el grosor estimado
        h = w.thickness / 2 + 1.5
        quad = np.array(
            [
                (w.x1 - dy * h, w.y1 + dx * h),
                (w.x2 - dy * h, w.y2 + dx * h),
                (w.x2 + dy * h, w.y2 - dx * h),
                (w.x1 + dy * h, w.y1 - dx * h),
            ]
        )
        cv2.fillPoly(walls, [np.round(quad).astype(np.int32)], 255)
    return np.asarray(cv2.bitwise_and(ink, cv2.bitwise_not(walls)), np.uint8)


def merge_openings(segments: list[Segment], t: float, mpp: float, ink: Img) -> list[Segment]:
    min_gap = MIN_OPENING_M / mpp
    max_gap = MAX_OPENING_M / mpp
    result: list[Segment] = []
    thin = thin_ink(ink, segments)
    for ang, group in _group_collinear(segments, t):
        ux, uy = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        nx, ny = -uy, ux
        pieces = []
        for s in group:
            p = [ux * s.x1 + uy * s.y1, ux * s.x2 + uy * s.y2]
            c = nx * (s.x1 + s.x2) / 2 + ny * (s.y1 + s.y2) / 2
            pieces.append(_Piece(min(p), max(p), c, s.thickness, s.confidence, []))
        pieces.sort(key=lambda p: p.start)

        def emit(p: _Piece, ux: float = ux, uy: float = uy, nx: float = nx, ny: float = ny) -> None:
            a = (ux * p.start + nx * p.offset, uy * p.start + ny * p.offset)
            b = (ux * p.end + nx * p.offset, uy * p.end + ny * p.offset)
            result.append(Segment(a[0], a[1], b[0], b[1], p.thickness, p.openings, p.confidence))

        cur = pieces[0]
        for nxt in pieces[1:]:
            gap = nxt.start - cur.end
            similar = 0.5 < nxt.thickness / cur.thickness < 2.0
            a = (ux * cur.end + nx * cur.offset, uy * cur.end + ny * cur.offset)
            b = (ux * nxt.start + nx * cur.offset, uy * nxt.start + ny * cur.offset)
            # un ventanal (vidrio de piso a techo) pasa de 2,6 m, pero tiene parantes; una
            # línea continua sola no basta (bordes de jardín, de piso o de cotas también lo son)
            glazed = (
                similar
                and max_gap < gap <= GLAZED_FACTOR * max_gap
                and mullion_count(ink, a, b, cur.thickness) >= MIN_MULLIONS
            )
            if gap <= min_gap or (similar and gap <= max_gap) or glazed:
                total = (cur.end - cur.start) + (nxt.end - nxt.start)
                w_cur = (cur.end - cur.start) / total if total else 0.5
                merged = _Piece(
                    cur.start,
                    max(cur.end, nxt.end),
                    cur.offset * w_cur + nxt.offset * (1 - w_cur),
                    cur.thickness * w_cur + nxt.thickness * (1 - w_cur),
                    min(cur.confidence, nxt.confidence),
                    cur.openings
                    + [replace(o, offset=o.offset + (nxt.start - cur.start)) for o in nxt.openings],
                )
                if gap > min_gap:
                    kind, conf = classify_gap(ink, a, b, merged.thickness)
                    op = _operation(kind, ink, a, b, merged.thickness)
                    if glazed:
                        # paño de vidrio con parantes de piso a techo: puerta-ventana corrediza
                        kind, conf, op = "door", max(conf, 0.7), "sliding"
                    elif kind == "door" and op is None and gap * mpp < MIN_DOOR_M:
                        kind, conf = "window", 0.6  # ninguna puerta es tan angosta
                    elif op is None and kind == "door" and not _has_swing(thin, a, b):
                        # vano vacío (sin hoja, arco ni corrediza): ventana si da al exterior,
                        # vano de puerta si comunica dos interiores (``resolve_empty_gaps``)
                        op = "none"
                    merged.openings.append(PxOpening(cur.end - cur.start, gap, kind, conf, op))
                cur = merged
            else:
                emit(cur)
                cur = nxt
        emit(cur)
    return result


def _ink_near(ink: Img, x: float, y: float, r: int = 2) -> bool:
    h, w = ink.shape[:2]
    xi, yi = round(x), round(y)
    if not (0 <= xi < w and 0 <= yi < h):
        return False
    return bool(ink[max(0, yi - r) : yi + r + 1, max(0, xi - r) : xi + r + 1].any())


def door_swing_evidence(
    ink: Img,
    hinge: tuple[float, float],
    u: tuple[float, float],
    width: float,
    use_leaf: bool = True,
) -> float:
    """Evidencia (0..1) del arco de giro o de la hoja de una puerta con bisagra en ``hinge``.

    ``u`` apunta de la bisagra hacia la otra jamba. La hoja abierta queda perpendicular al
    muro (a uno u otro lado) y el arco une su punta con la otra jamba: se muestrean ambos.
    Si el cuarto de círculo de barrido está densamente entintado es una textura (adoquines,
    baldosas, césped) y ese lado no cuenta: ahí cualquier muestreo "encuentra" un arco.
    Los arcos punteados de muchos planos dan ~0,4-0,6.
    """

    def ring(n: tuple[float, float], radius: float) -> float:
        # se ignoran los extremos del arco: junto a las jambas cae tinta ajena (muros, hojas
        # de otras puertas) que no prueba nada
        steps, lo, hi = 24, 4, 21
        hits = 0
        for k in range(lo, hi + 1):
            a = math.pi / 2 * k / steps
            px = hinge[0] + radius * (u[0] * math.cos(a) + n[0] * math.sin(a))
            py = hinge[1] + radius * (u[1] * math.cos(a) + n[1] * math.sin(a))
            hits += _ink_near(ink, px, py)
        return hits / (hi - lo + 1)

    def textured(n: tuple[float, float]) -> bool:
        h, w = ink.shape[:2]
        pts = []
        for i in range(1, 6):
            for j in range(1, 6):
                a, r = math.pi / 2 * (j - 0.5) / 5, width * (i - 0.5) / 5
                x = round(hinge[0] + r * (u[0] * math.cos(a) + n[0] * math.sin(a)))
                y = round(hinge[1] + r * (u[1] * math.cos(a) + n[1] * math.sin(a)))
                if 0 <= x < w and 0 <= y < h:
                    pts.append(bool(ink[y, x]))
        return bool(pts) and sum(pts) / len(pts) > TEXTURE_DENSITY

    def ray(n: tuple[float, float], angle: float, reach: int = 12) -> float:
        # la hoja va pegada a la jamba, que puede quedar unos px más allá del extremo
        # detectado del muro: se busca en una franja de hasta ~6 px dentro del vano
        c, s_ = math.cos(angle), math.sin(angle)
        v = (u[0] * c + n[0] * s_, u[1] * c + n[1] * s_)
        hits = 0
        for k in range(2, reach):
            f = width * k / 12
            hits += any(
                _ink_near(ink, hinge[0] + u[0] * d + v[0] * f, hinge[1] + u[1] * d + v[1] * f, 1)
                for d in (1, 3.5, 6)
            )
        return hits / (reach - 2)

    best = 0.0
    for side in (1.0, -1.0):
        n = (-u[1] * side, u[0] * side)
        if textured(n):
            continue
        leaf = ray(n, math.pi / 2) if use_leaf else 0.0
        best = max(best, ring(n, width), leaf)
    return best


SWING_EVIDENCE = 0.4
#: la puerta más angosta que se construye (baños de servicio) ronda los 0,6 m; se deja
#: margen porque un vano medido en la imagen puede salir algo más corto
MIN_DOOR_M = 0.55
#: fracción de puntos con tinta en el área de barrido por encima de la cual es textura
TEXTURE_DENSITY = 0.25
GLAZED_FACTOR = 2.5
MAX_SWING_DOOR_M = 1.25
WINDOW_LINE_EVIDENCE = 0.8


MIN_MULLIONS = 2
#: dispersión máxima (desvío / media) de las separaciones entre parantes
MULLION_REGULARITY = 0.3


def mullion_count(
    ink: Img, a: tuple[float, float], b: tuple[float, float], thickness: float
) -> int:
    """Parantes de un ventanal: manchas cortas de tinta sobre el eje del muro dentro del vano.

    Muchos renders dibujan el vidrio con un gris claro que no llega a ser tinta, pero los
    parantes (y marcos) sí. Un paño de vidrio los tiene equiespaciados entre jamba y jamba;
    si las separaciones son irregulares (juntas de adoquín, hojas de plantas) se devuelve 0.
    """
    length = math.dist(a, b)
    if length < 1:
        return 0
    ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    margin = thickness  # las jambas no cuentan
    centers: list[float] = []
    inside, run = False, 0
    for k in range(int(margin), int(length - margin)):
        hit = _ink_near(ink, a[0] + ux * k, a[1] + uy * k, 0)
        if hit and not inside:
            inside, run = True, 0
        if inside:
            run += 1
        if not hit and inside:
            inside = False
            c = k - run / 2
            cx, cy = a[0] + ux * c, a[1] + uy * c
            # un parante es corto a lo largo y no se sale del grosor del muro (un mueble sí)
            across = sum(
                _ink_near(ink, cx - uy * d, cy + ux * d, 0)
                for d in (-1.5 * thickness, 1.5 * thickness)
            )
            if run <= 2 * thickness and across == 0:
                centers.append(c)
    if not centers:
        return 0
    gaps = np.diff([0.0, *centers, length])
    return len(centers) if float(gaps.std() / gaps.mean()) <= MULLION_REGULARITY else 0


def window_line_evidence(
    ink: Img, a: tuple[float, float], b: tuple[float, float], thickness: float
) -> float:
    """Cobertura de la mejor línea fina CONTINUA paralela al muro dentro de su banda.

    Una ventana (o una corrediza) se dibuja con líneas que cruzan todo el vano; los muebles
    junto al muro (lavamanos, inodoro, mesones) dejan tinta en la banda pero no una línea
    continua de jamba a jamba.
    """
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    if length < 1:
        return 0.0
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux
    steps = max(8, int(length / 2))
    best = 0.0
    for k in range(-4, 5):
        off = thickness * 0.4 * k / 4
        hits = sum(
            _ink_near(
                ink,
                a[0] + ux * length * s / steps + nx * off,
                a[1] + uy * length * s / steps + ny * off,
                1,
            )
            for s in range(1, steps)
        )
        best = max(best, hits / (steps - 1))
    return best


def bridge_end_gaps(segments: list[Segment], t: float, mpp: float, ink: Img) -> list[Segment]:
    """Huecos entre el EXTREMO de un muro y otro muro (no colineal) más adelante en su eje.

    ``merge_openings`` solo ve huecos entre tramos de la misma recta. Una puerta que va de
    la punta de un tabique hasta un muro transversal (típica de baños y closets) quedaba
    abierta y unía dos ambientes. Aquí se prolonga el muro hasta el otro y el tramo nuevo
    es la abertura, pero solo si la tinta lo respalda: arco u hoja de puerta, o líneas
    finas de ventana/corrediza en la banda, o que el vano esté en la fachada (un lado fuera
    del edificio). Sin evidencia no se inventa nada (una esquina normal también tiene un
    muro "más adelante").
    """
    min_gap = MIN_OPENING_M / mpp
    max_gap = MAX_OPENING_M / mpp
    out = list(segments)
    thin = thin_ink(ink, out)
    on_envelope = envelope_test(out, t)

    for i, s in enumerate(out):
        for end in (0, 1):
            ex, ey = (s.x2, s.y2) if end else (s.x1, s.y1)
            ux, uy = s.direction if end else (-s.direction[0], -s.direction[1])
            best: tuple[float, float, int] | None = (
                None  # (distancia libre, avance hasta el eje, j)
            )
            for j, o in enumerate(out):
                if j == i or _angle_diff(o.angle, s.angle) < 30:
                    continue
                # intersección del rayo con el eje del otro muro
                ox, oy = o.direction
                den = ux * oy - uy * ox
                if abs(den) < 1e-6:
                    continue
                rx, ry = o.x1 - ex, o.y1 - ey
                along = (rx * oy - ry * ox) / den
                tt = (rx * uy - ry * ux) / den
                if along <= 0 or not (-o.thickness <= tt <= o.length + o.thickness):
                    continue
                free = along - o.thickness / 2
                if free < 0.5 * t:  # ya lo toca: es una unión, no un hueco
                    best = None
                    break
                if min_gap <= free <= max_gap and (best is None or free < best[0]):
                    best = (free, along, j)
            if best is None:
                continue
            free, along, _ = best
            a = (ex, ey)
            b = (ex + ux * free, ey + uy * free)
            kind, conf = classify_gap(ink, a, b, s.thickness)
            sliding: str | None = None
            swing = max(
                door_swing_evidence(thin, a, (ux, uy), free),
                # bisagra sobre la cara del muro transversal: la hoja abierta quedaría a lo
                # largo de esa cara y se confunde con su borde; ahí solo cuenta el arco
                door_swing_evidence(thin, b, (-ux, -uy), free, use_leaf=False),
            )
            # una puerta batiente de una hoja no pasa de ~1,25 m; un arco más grande cruza
            # cualquier línea del plano por casualidad
            if swing >= SWING_EVIDENCE and MIN_DOOR_M <= free * mpp <= MAX_SWING_DOOR_M:
                # el arco manda: su propia tinta en la banda no la vuelve ventana
                kind, conf = "door", max(conf, 0.85)
            elif (sliding := _operation("door", ink, a, b, s.thickness)) is not None:
                kind, conf = "door", max(conf, 0.8)
            elif window_line_evidence(thin, a, b, s.thickness) >= WINDOW_LINE_EVIDENCE:
                kind, conf = "window", max(conf, 0.8)
            elif on_envelope(a, b):
                # la fachada no tiene agujeros: un vano sin trazos en ella es una ventana
                # (los renders las dibujan como un hueco con relleno claro)
                kind, conf = "window", 0.5
            else:
                continue  # sin arco, hoja ni líneas de ventana: no se inventa la abertura
            nx, ny = ex + ux * along, ey + uy * along
            if end:
                ops = [*s.openings, PxOpening(s.length, free, kind, conf, sliding)]
                out[i] = Segment(s.x1, s.y1, nx, ny, s.thickness, ops, s.confidence)
            else:
                shift = along
                ops = [replace(o, offset=o.offset + shift) for o in s.openings]
                ops.insert(0, PxOpening(along - free, free, kind, conf, sliding))
                out[i] = Segment(nx, ny, s.x2, s.y2, s.thickness, ops, s.confidence)
            s = out[i]
    return out


def resolve_empty_gaps(segments: list[Segment], shape: tuple[int, ...], t: float) -> list[Segment]:
    """Decide los vanos vacíos (``operation == "none"``) mirando a qué dan.

    Con todos los muros dibujados (vanos cerrados), lo libre conectado al borde de la imagen
    es el exterior. Un vano vacío con un lado afuera y otro adentro es una ventana (los
    renders las pintan como un hueco claro); entre dos interiores, un vano de puerta.
    """
    from plano3d.infrastructure.cv.stages.walls import draw_segment

    mask = np.zeros(shape[:2], np.uint8)
    for s in segments:
        draw_segment(mask, s, extend=True)
    free = cv2.bitwise_not(mask)
    _, labels = cv2.connectedComponents(free, connectivity=4)
    border = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])))
    border.discard(0)
    h, w = mask.shape

    def outside(x: float, y: float) -> bool | None:
        xi, yi = round(x), round(y)
        if not (0 <= xi < w and 0 <= yi < h) or mask[yi, xi]:
            return None
        return int(labels[yi, xi]) in border

    out: list[Segment] = []
    for s in segments:
        dx, dy = s.direction
        ops = []
        for o in s.openings:
            if o.operation == "none":
                c = o.offset + o.width / 2
                cx, cy = s.x1 + dx * c, s.y1 + dy * c
                d = s.thickness / 2 + t
                sides = {outside(cx - dy * d, cy + dx * d), outside(cx + dy * d, cy - dx * d)}
                if sides == {True, False}:
                    o = replace(o, kind="window", operation=None, confidence=0.5)
            ops.append(o)
        out.append(replace(s, openings=ops))
    return out


class OpeningsStage(PipelineStage[CVContext]):
    key = "openings"
    title = "Detección de puertas y ventanas"

    def run(self, ctx: CVContext) -> CVContext:
        ink = ctx.require(ctx.ink, "ink")
        if ctx.texts:
            # las letras no son evidencia de arcos, hojas ni vidrios
            ink = as_u8(cv2.bitwise_and(ink, cv2.bitwise_not(text_mask(ink.shape, ctx.texts))))
        segs = merge_openings(ctx.segments, ctx.wall_thickness_px, ctx.meters_per_pixel, ink)
        segs = bridge_end_gaps(segs, ctx.wall_thickness_px, ctx.meters_per_pixel, ink)
        ctx.segments = resolve_empty_gaps(segs, ink.shape, ctx.wall_thickness_px)
        if ctx.scale_hint is None and ctx.scale_confidence < DOOR_SCALE_CONFIDENCE:
            # sin cotas, el ancho de las puertas es mejor regla que el grosor de los muros
            mpp = scale_from_doors(ctx.segments, ctx.meters_per_pixel)
            if mpp is not None:
                ctx.meters_per_pixel, ctx.scale_confidence = mpp, DOOR_SCALE_CONFIDENCE
        return ctx

    def metrics(self, ctx: CVContext) -> dict[str, float]:
        ops = [o for s in ctx.segments for o in s.openings]
        return {
            "doors": sum(1 for o in ops if o.kind == "door"),
            "windows": sum(1 for o in ops if o.kind == "window"),
            "wall_count": len(ctx.segments),
        }

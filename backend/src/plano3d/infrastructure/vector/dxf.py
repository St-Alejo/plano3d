"""Lector DXF (ezdxf, MIT) → ``Drawing`` en metros con y hacia abajo.

- Unidades: ``$INSUNITS`` (mm, cm, m, pulgadas, pies); si el archivo no las declara se
  deducen del tamaño del dibujo (un edificio no mide 2000 m).
- Capas: si hay capas de MUROS se usan solo esas para los muros; las de puertas y
  ventanas, y el contenido de bloques de puertas/ventanas, son "detalle" (evidencia de
  aberturas); cotas, textos y mobiliario no son geometría de muros.
- Cotas: se toma el valor REAL de la entidad DIMENSION (o el texto que escribió el
  dibujante, si lo cambió). Es la ruta de exactitud: no hay OCR de por medio.
"""

from __future__ import annotations

import io
import math
from collections.abc import Iterable
from typing import Any

from ezdxf import bbox as ezbbox
from ezdxf import path as ezpath
from ezdxf.recover import read as recover_read

from plano3d.domain.plan_text import parse_length
from plano3d.infrastructure.vector.primitives import (
    ArcPrim,
    Closed,
    DimPrim,
    Drawing,
    Insert,
    LayerRole,
    Line,
    Text,
    block_kind,
    layer_role,
)

UNIT_TO_M = {1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1.0, 14: 0.1}


class DxfReadError(ValueError):
    pass


def looks_like_dxf(data: bytes) -> bool:
    head = data[:2048].lstrip()
    if head.startswith(b"AutoCAD Binary DXF"):
        return True
    text = head.decode("latin-1", errors="ignore").replace("\r", "")
    return text.startswith("0\nSECTION") or "\nSECTION\n" in text[:200]


def _guess_unit(extent: float) -> float:
    """Factor a metros cuando el archivo no declara unidades."""
    if extent > 2000:
        return 0.001  # milímetros
    if extent > 300:
        return 0.01  # centímetros
    return 1.0


class _Collector:
    def __init__(self, f: float) -> None:
        self.f = f
        self.d = Drawing()
        self.wall_layers: set[str] = set()

    def p(self, v: Any) -> tuple[float, float]:
        return (float(v[0]) * self.f, -float(v[1]) * self.f)

    def line(self, a: Any, b: Any, layer: str, detail: bool) -> None:
        (x1, y1), (x2, y2) = self.p(a), self.p(b)
        ln = Line(x1, y1, x2, y2, layer)
        if ln.length < 1e-4:
            return
        (self.d.detail_lines if detail else self.d.lines).append(ln)

    def arc(
        self, center: Any, r: float, a0_deg: float, a1_deg: float, layer: str, detail: bool
    ) -> None:
        cx, cy = self.p(center)
        # DXF: antihorario de a0 a a1 con y hacia arriba. Al invertir y, el ángulo cambia
        # de signo: el mismo arco va de -a0 a -a1 en sentido horario.
        sweep_up = (a1_deg - a0_deg) % 360 or 360
        arc = ArcPrim(cx, cy, r * self.f, -math.radians(a0_deg), -math.radians(sweep_up), layer)
        (self.d.detail_arcs if detail else self.d.arcs).append(arc)


def _entities(e: Any, depth: int = 0) -> Iterable[tuple[Any, Any | None]]:
    """Entidades planas; los bloques genéricos se explotan (hasta 3 niveles)."""
    if e.dxftype() == "INSERT" and depth < 3 and block_kind(e.dxf.name) is None:
        try:
            for sub in e.virtual_entities():
                yield from _entities(sub, depth + 1)
        except Exception:  # bloque corrupto: se ignora
            return
        return
    yield e, None


def read_dxf(data: bytes) -> Drawing:
    try:
        doc, _auditor = recover_read(io.BytesIO(data))
    except Exception as exc:
        raise DxfReadError(f"No se pudo leer el DXF: {exc}") from exc
    msp = doc.modelspace()
    units = int(doc.header.get("$INSUNITS", 0) or 0)
    f = UNIT_TO_M.get(units)
    if f is None:
        try:
            box = ezbbox.extents(msp, fast=True)
            extent = max(box.size.x, box.size.y) if box.has_data else 0.0
        except Exception:
            extent = 0.0
        f = _guess_unit(extent)

    layers = {lay.dxf.name: layer_role(lay.dxf.name) for lay in doc.layers}
    has_wall_layers = sum(
        1
        for e in msp.query("LINE LWPOLYLINE POLYLINE")
        if layers.get(e.dxf.layer) is LayerRole.WALL
    )
    c = _Collector(f)

    def role(layer: str) -> LayerRole:
        return layers.get(layer, layer_role(layer))

    def wall_ok(layer: str) -> bool:
        r = role(layer)
        if has_wall_layers >= 4:
            return r in (LayerRole.WALL, LayerRole.STAIR)
        return r in (LayerRole.WALL, LayerRole.UNKNOWN, LayerRole.STAIR)

    for top in msp:
        for e, _ in _entities(top):
            kind = e.dxftype()
            layer = e.dxf.get("layer", "0")
            r = role(layer)
            if kind == "INSERT":
                bk = block_kind(e.dxf.name)
                x, y = c.p(e.dxf.insert)
                c.d.inserts.append(Insert(x, y, e.dxf.name, layer))
                if bk:
                    for sub in e.virtual_entities():
                        _add_geometry(c, sub, sub.dxf.get("layer", layer), detail=True)
                continue
            if kind in ("TEXT", "MTEXT", "ATTRIB"):
                _add_text(c, e, layer)
                continue
            if kind == "DIMENSION":
                _add_dimension(c, e, layer)
                continue
            if kind == "HATCH":
                _add_hatch(c, e, layer)
                continue
            if r is LayerRole.COLUMN:
                _add_closed(c, e, layer, filled=False)
                continue
            if r is LayerRole.OPENING:
                _add_geometry(c, e, layer, detail=True)
                continue
            if r is LayerRole.IGNORE or not wall_ok(layer):
                continue
            if _add_closed(c, e, layer, filled=False, only_small=True):
                continue
            if _is_object_outline(c, e):
                continue  # mueble, mesón, aparato: contorno cerrado que no es un muro
            _add_geometry(c, e, layer, detail=False)
    _mark_filled(c.d)
    return c.d


def _add_geometry(c: _Collector, e: Any, layer: str, detail: bool) -> None:
    kind = e.dxftype()
    if kind == "LINE":
        c.line(e.dxf.start, e.dxf.end, layer, detail)
    elif kind == "ARC":
        c.arc(e.dxf.center, e.dxf.radius, e.dxf.start_angle, e.dxf.end_angle, layer, detail)
    elif kind == "CIRCLE":
        c.arc(e.dxf.center, e.dxf.radius, 0.0, 360.0, layer, detail)
    elif kind in ("LWPOLYLINE", "POLYLINE"):
        try:
            subs = list(e.virtual_entities())
        except Exception:
            return
        for sub in subs:
            _add_geometry(c, sub, layer, detail)


def _ring(e: Any, c: _Collector) -> list[tuple[float, float]] | None:
    kind = e.dxftype()
    if kind == "CIRCLE":
        cx, cy = c.p(e.dxf.center)
        r = e.dxf.radius * c.f
        return [
            (cx + r * math.cos(2 * math.pi * k / 24), cy + r * math.sin(2 * math.pi * k / 24))
            for k in range(24)
        ]
    if kind in ("LWPOLYLINE", "POLYLINE") and e.is_closed:
        pts = [c.p(v) for v in ezpath.make_path(e).flattening(0.005)]
        if len(pts) > 1 and math.dist(pts[0], pts[-1]) < 1e-6:
            pts = pts[:-1]
        return pts if len(pts) >= 3 else None
    return None


def _add_closed(c: _Collector, e: Any, layer: str, filled: bool, only_small: bool = False) -> bool:
    pts = _ring(e, c)
    if pts is None:
        return False
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    small = max(max(xs) - min(xs), max(ys) - min(ys)) <= 1.2
    if only_small and not small:
        return False
    c.d.closed.append(Closed(tuple(pts), filled, layer))
    return True


def _is_object_outline(c: _Collector, e: Any) -> bool:
    """Un contorno cerrado de hasta 4 m que NO es angosto y alargado no es un muro.

    En CAD un muro suelto a veces se dibuja como rectángulo cerrado, pero entonces es
    delgado (≤ 40 cm) y largo; una cama, un sofá o un mesón no.
    """
    pts = _ring(e, c)
    if pts is None:
        return False
    from shapely.geometry import Polygon

    poly = Polygon(pts)
    if not poly.is_valid or poly.area <= 0:
        return False
    rect = poly.minimum_rotated_rectangle
    xs, ys = rect.exterior.coords.xy
    e1 = math.dist((xs[0], ys[0]), (xs[1], ys[1]))
    e2 = math.dist((xs[1], ys[1]), (xs[2], ys[2]))
    short, long_ = min(e1, e2), max(e1, e2)
    if long_ > 4.0:
        return False
    return not (short <= 0.4 and long_ >= 3 * short)


def _add_hatch(c: _Collector, e: Any, layer: str) -> None:
    """Los sombreados sólidos pequeños marcan columnas (se cruzan con los contornos)."""
    if not e.dxf.get("solid_fill", 0):
        return
    try:
        paths = ezpath.from_hatch(e)
    except Exception:
        return
    for p in paths:
        pts = [c.p(v) for v in p.flattening(0.005)]
        if len(pts) >= 3:
            xs = [q[0] for q in pts]
            ys = [q[1] for q in pts]
            if max(max(xs) - min(xs), max(ys) - min(ys)) <= 1.2:
                c.d.closed.append(Closed(tuple(pts), True, layer))


def _mark_filled(d: Drawing) -> None:
    """Un contorno cerrado con un sombreado sólido encima cuenta como relleno."""
    fills = [cl for cl in d.closed if cl.filled]
    if not fills:
        return
    out: list[Closed] = []
    for cl in d.closed:
        if cl.filled:
            continue
        cx = sum(p[0] for p in cl.points) / len(cl.points)
        cy = sum(p[1] for p in cl.points) / len(cl.points)
        hit = any(
            abs(cx - sum(p[0] for p in f.points) / len(f.points)) < 0.05
            and abs(cy - sum(p[1] for p in f.points) / len(f.points)) < 0.05
            for f in fills
        )
        out.append(Closed(cl.points, hit, cl.layer))
    # los sombreados sin contorno propio también son columnas
    for f in fills:
        fx = sum(p[0] for p in f.points) / len(f.points)
        fy = sum(p[1] for p in f.points) / len(f.points)
        if not any(
            abs(fx - sum(p[0] for p in cl.points) / len(cl.points)) < 0.05
            and abs(fy - sum(p[1] for p in cl.points) / len(cl.points)) < 0.05
            for cl in out
        ):
            out.append(f)
    d.closed = out


def _add_text(c: _Collector, e: Any, layer: str) -> None:
    kind = e.dxftype()
    if kind == "MTEXT":
        text = e.plain_text()
        x, y = c.p(e.dxf.insert)
        h = e.dxf.get("char_height", 0.0) * c.f
        rot = math.radians(e.dxf.get("rotation", 0.0))
    else:
        text = e.plain_text() if hasattr(e, "plain_text") else e.dxf.text
        align = e.dxf.get("align_point") if e.dxf.get("halign", 0) else None
        x, y = c.p(align if align is not None else e.dxf.insert)
        h = e.dxf.get("height", 0.0) * c.f
        rot = math.radians(e.dxf.get("rotation", 0.0))
    text = " ".join(str(text).split())
    if text:
        c.d.texts.append(Text(x, y, text, h, -rot, layer))


def _add_dimension(c: _Collector, e: Any, layer: str) -> None:
    dimtype = e.dimtype
    if dimtype not in (0, 1):  # solo lineales y alineadas
        return
    try:
        a = c.p(e.dxf.defpoint2)
        b = c.p(e.dxf.defpoint3)
        base = c.p(e.dxf.defpoint)
        measurement = float(e.get_measurement()) * c.f
    except Exception:
        return
    shown = (e.dxf.get("text", "") or "").strip()
    value = measurement
    if shown and shown not in ("<>", " "):
        parsed = parse_length(shown.replace("<>", ""))
        if parsed is not None:
            value = parsed.meters
    else:
        shown = ""
    if value <= 0:
        return
    if dimtype == 0:
        ang = e.dxf.get("angle", 0.0) % 180
        axis = "horizontal" if abs(ang) < 1 or abs(ang - 180) < 1 else "vertical"
        if not (abs(ang) < 1 or abs(ang - 90) < 1 or abs(ang - 180) < 1):
            axis = "aligned"
    else:
        axis = "aligned"
    # desplazamiento de la línea de cota respecto a a-b (signo según la normal izquierda)
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy) or 1.0
    offset = ((base[0] - a[0]) * -dy / n) + ((base[1] - a[1]) * dx / n)
    c.d.dims.append(DimPrim(a, b, value, shown, axis, offset, layer))

"""Exporta un plano sintético a DXF como lo dibujaría un arquitecto en CAD.

- Muros: SOLO las caras (doble línea), cortadas en las aberturas y unidas en las
  esquinas y encuentros en T, como queda al recortar en AutoCAD. Los curvos con dos ARC.
- Ventanas: tres líneas paralelas en el vano; puertas: hoja + arco de giro.
  Opcionalmente como BLOQUES insertados (``blocks=True``).
- Columnas: polilínea cerrada + sombreado sólido; escalera: contorno + huellas.
- Cotas: entidades DIMENSION reales (con su valor), textos de ambientes, áreas y nivel.

``units``: "m", "cm" o "mm" (con ``$INSUNITS``); ``declare_units=False`` deja el archivo
sin unidades (hay que deducirlas). ``layers=False`` pone todo en la capa "0".
"""

from __future__ import annotations

import io
import itertools
import math
from typing import Literal

import ezdxf
from shapely.geometry import Polygon
from shapely.ops import unary_union

from tests.synth.complex_plans import ComplexPlan, format_dimension, wall_pieces_polygons
from tests.synth.plan_generator import Pt, SynthWall

UNITS = {"m": (1.0, 6), "cm": (100.0, 5), "mm": (1000.0, 4)}


def plan_to_dxf(
    plan: ComplexPlan,
    units: Literal["m", "cm", "mm"] = "m",
    layers: bool = True,
    blocks: bool = False,
    declare_units: bool = True,
) -> bytes:
    f, code = UNITS[units]
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = code if declare_units else 0
    msp = doc.modelspace()

    def lay(name: str) -> str:
        if not layers:
            return "0"
        if name not in doc.layers:
            doc.layers.add(name)
        return name

    def P(p: Pt) -> tuple[float, float]:  # noqa: N802 - metros (y abajo) → DXF (y arriba)
        return (p[0] * f, -p[1] * f)

    # ---- muros rectos: contorno de la unión de tramos sólidos, sin los curvos
    curved = [w for w in plan.walls if abs(w.bulge) > 1e-9]
    straight = [w for w in plan.walls if abs(w.bulge) <= 1e-9]
    solid = unary_union([p for w in straight for p in wall_pieces_polygons(w)])
    if curved:
        solid = solid.difference(unary_union([_curved_poly(w) for w in curved]))
    for poly in getattr(solid, "geoms", [solid]):
        if poly.is_empty:
            continue
        poly = poly.simplify(1e-6)
        for ring in (poly.exterior, *poly.interiors):
            pts = list(ring.coords)
            for a, b in itertools.pairwise(pts):
                msp.add_line(P(a), P(b), dxfattribs={"layer": lay("MUROS")})

    # ---- muros curvos: dos arcos concéntricos y sus tapas
    for w in curved:
        cx, cy, r, a0, a1 = _arc_params(w)
        h = w.thickness / 2
        for rr in (r - h, r + h):
            msp.add_arc(P((cx, cy)), rr * f, a0, a1, dxfattribs={"layer": lay("MUROS")})
        for ang in (a0, a1):
            t = math.radians(ang)
            p_in = (cx + (r - h) * math.cos(t), cy - (r - h) * math.sin(t))
            p_out = (cx + (r + h) * math.cos(t), cy - (r + h) * math.sin(t))
            msp.add_line(P(p_in), P(p_out), dxfattribs={"layer": lay("MUROS")})

    # ---- aberturas
    if blocks:
        _define_blocks(doc, f)
    for w in straight:
        ux, uy = (w.b[0] - w.a[0]) / w.length, (w.b[1] - w.a[1]) / w.length
        nx, ny = -uy, ux
        h = w.thickness / 2
        for op in w.openings:
            p0 = (w.a[0] + ux * op.offset, w.a[1] + uy * op.offset)
            p1 = (w.a[0] + ux * (op.offset + op.width), w.a[1] + uy * (op.offset + op.width))
            if blocks:
                mid = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
                name = "VENTANA" if op.kind == "window" else "PUERTA"
                msp.add_blockref(
                    name,
                    P(mid),
                    dxfattribs={
                        "layer": lay("CARPINTERIA"),
                        "rotation": -math.degrees(math.atan2(uy, ux)),
                        "xscale": op.width * f,
                        "yscale": w.thickness * f,
                    },
                )
                continue
            if op.kind == "window":
                for k in (-h, 0.0, h):
                    msp.add_line(
                        P((p0[0] + nx * k, p0[1] + ny * k)),
                        P((p1[0] + nx * k, p1[1] + ny * k)),
                        dxfattribs={"layer": lay("VENTANAS")},
                    )
            else:
                leaf = (p0[0] + nx * op.width, p0[1] + ny * op.width)
                msp.add_line(P(p0), P(leaf), dxfattribs={"layer": lay("PUERTAS")})
                # arco de giro de la dirección del muro a la normal (en coords y-arriba)
                a_wall = -math.degrees(math.atan2(uy, ux))
                a_norm = -math.degrees(math.atan2(ny, nx))
                start, end = sorted((a_wall, a_norm))
                if end - start > 180:
                    start, end = end, start + 360
                msp.add_arc(P(p0), op.width * f, start, end, dxfattribs={"layer": lay("PUERTAS")})

    # ---- columnas
    for c in plan.columns:
        if c.round:
            msp.add_circle(P(c.center), c.size / 2 * f, dxfattribs={"layer": lay("COLUMNAS")})
            hatch = msp.add_hatch(color=7, dxfattribs={"layer": lay("COLUMNAS")})
            hatch.paths.add_edge_path().add_arc(P(c.center), c.size / 2 * f, 0, 360)
        else:
            h = c.size / 2
            ring = [
                P((c.center[0] - h, c.center[1] - h)),
                P((c.center[0] + h, c.center[1] - h)),
                P((c.center[0] + h, c.center[1] + h)),
                P((c.center[0] - h, c.center[1] + h)),
            ]
            msp.add_lwpolyline(ring, close=True, dxfattribs={"layer": lay("COLUMNAS")})
            hatch = msp.add_hatch(color=7, dxfattribs={"layer": lay("COLUMNAS")})
            hatch.paths.add_polyline_path(ring, is_closed=True)

    # ---- escaleras
    for st in plan.stairs:
        x0, y0, x1, y1 = st.x0, st.y0, st.x1, st.y1
        for a, b in (
            ((x0, y0), (x1, y0)),
            ((x1, y0), (x1, y1)),
            ((x1, y1), (x0, y1)),
            ((x0, y1), (x0, y0)),
        ):
            msp.add_line(P(a), P(b), dxfattribs={"layer": lay("ESCALERAS")})
        for k in range(1, st.steps):
            t = k / st.steps
            if st.axis == "x":
                x = x0 + (x1 - x0) * t
                msp.add_line(P((x, y0)), P((x, y1)), dxfattribs={"layer": lay("ESCALERAS")})
            else:
                y = y0 + (y1 - y0) * t
                msp.add_line(P((x0, y)), P((x1, y)), dxfattribs={"layer": lay("ESCALERAS")})

    # ---- mobiliario
    for (x0, y0), (x1, y1) in plan.furniture:
        msp.add_lwpolyline(
            [P((x0, y0)), P((x1, y0)), P((x1, y1)), P((x0, y1))],
            close=True,
            dxfattribs={"layer": lay("MOBILIARIO")},
        )

    # ---- textos
    th = 0.2 * f
    for room in plan.rooms:
        c = Polygon(room.polygon).representative_point()
        _text(msp, room.label, P((c.x, c.y - 0.2)), th, lay("TEXTOS"))
        area = format_dimension(Polygon(room.polygon).area, "m")[0]
        _text(msp, f"A= {area} m²", P((c.x, c.y + 0.25)), th * 0.8, lay("TEXTOS"))
    c0 = Polygon(plan.rooms[0].polygon).representative_point()
    _text(msp, plan.level_mark, P((c0.x, c0.y + 0.7)), th * 0.8, lay("TEXTOS"))
    _text(
        msp,
        f"PLANTA ARQUITECTÓNICA {plan.scale_label}",
        P((plan.width_m - 3, plan.height_m + 1.4)),
        th,
        lay("TEXTOS"),
    )

    # ---- cotas
    for d in plan.dimensions:
        if d.horizontal:
            base = P((d.a[0], d.at))
            angle = 0.0
        else:
            base = P((d.at, d.a[1]))
            angle = 90.0
        text = format_dimension(d.value, "m")[0] if units == "m" else "<>"
        dim = msp.add_linear_dim(
            base=base,
            p1=P(d.a),
            p2=P(d.b),
            angle=angle,
            text=text,
            dxfattribs={"layer": lay("COTAS")},
        )
        dim.render()

    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")


def _text(msp: object, text: str, at: tuple[float, float], h: float, layer: str) -> None:
    t = msp.add_text(text, height=h, dxfattribs={"layer": layer})  # type: ignore[attr-defined]
    t.set_placement(at, align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)


def _curved_poly(w: SynthWall) -> Polygon:
    from shapely.geometry import LineString

    return LineString(w.axis_points(0.02)).buffer(w.thickness / 2, cap_style="flat")


def _arc_params(w: SynthWall) -> tuple[float, float, float, float, float]:
    """Centro (m, y abajo), radio y ángulos inicial/final en grados DXF (y arriba, antihorario)."""
    pts = w.axis_points(0.01)
    (ax, ay), (bx, by) = w.a, w.b
    c = w.length
    s = w.bulge
    radius = (c * c / 4 + s * s) / (2 * abs(s))
    dx, dy = (bx - ax) / c, (by - ay) / c
    nx, ny = -dy, dx
    sign = 1.0 if s > 0 else -1.0
    d = radius - abs(s)
    mx, my = (ax + bx) / 2, (ay + by) / 2
    cx, cy = mx - sign * nx * d, my - sign * ny * d
    # ángulos en y-arriba: θ = atan2(-(y - cy), x - cx)
    angs = [math.degrees(math.atan2(-(p[1] - cy), p[0] - cx)) for p in pts]
    a_first, a_mid, a_last = angs[0], angs[len(angs) // 2], angs[-1]
    # el arco DXF va antihorario de start a end y debe pasar por a_mid
    start, end = a_first, a_last
    if (a_mid - start) % 360 > (end - start) % 360:
        start, end = a_last, a_first
    return cx, cy, radius, start % 360, end % 360


def _define_blocks(doc: ezdxf.document.Drawing, f: float) -> None:
    """Bloques unitarios (1 x 1) que se escalan al ancho del vano y al espesor del muro."""
    v = doc.blocks.new("VENTANA")
    for k in (-0.5, 0.0, 0.5):
        v.add_line((-0.5, k), (0.5, k))
    p = doc.blocks.new("PUERTA")
    p.add_line((-0.5, 0), (-0.5, 1.0))

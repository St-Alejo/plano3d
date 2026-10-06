"""Exporta un plano sintético a un PDF VECTORIAL "impreso a escala" desde CAD.

Escribe el PDF a mano (sin dependencias): líneas, arcos como Bézier, rellenos y texto
Helvetica. Como en un PDF real de arquitectura, no hay entidades de cota: la cota es una
línea con marcas y un texto encima, y la escala solo se conoce por el rótulo
``ESC 1:50`` o por esos textos. ``with_scale_label=False`` quita el rótulo.
"""

from __future__ import annotations

import itertools
import math

from shapely.geometry import Polygon
from shapely.ops import unary_union

from tests.synth.complex_plans import ComplexPlan, format_dimension, wall_pieces_polygons
from tests.synth.plan_generator import Pt
from tests.synth.to_dxf import _arc_params, _curved_poly

PT_PER_M_AT_1 = 72 / 0.0254  # puntos por metro a escala 1:1


class _Pdf:
    def __init__(self, width: float, height: float) -> None:
        self.w = width
        self.h = height
        self.ops: list[str] = []

    def line(self, a: Pt, b: Pt, width: float = 0.4) -> None:
        self.ops.append(f"{width:.2f} w {a[0]:.3f} {a[1]:.3f} m {b[0]:.3f} {b[1]:.3f} l S")

    def arc(self, c: Pt, r: float, a0: float, a1: float, width: float = 0.4) -> None:
        """Arco antihorario (y arriba) de a0 a a1 grados, en tramos Bézier de ≤ 90°."""
        sweep = (a1 - a0) % 360 or 360
        n = max(1, math.ceil(sweep / 90))
        step = math.radians(sweep / n)
        t = math.radians(a0)
        k = 4 / 3 * math.tan(step / 4)
        x0, y0 = c[0] + r * math.cos(t), c[1] + r * math.sin(t)
        parts = [f"{width:.2f} w {x0:.3f} {y0:.3f} m"]
        for _ in range(n):
            t1 = t + step
            p1 = (
                c[0] + r * (math.cos(t) - k * math.sin(t)),
                c[1] + r * (math.sin(t) + k * math.cos(t)),
            )
            p2 = (
                c[0] + r * (math.cos(t1) + k * math.sin(t1)),
                c[1] + r * (math.sin(t1) - k * math.cos(t1)),
            )
            p3 = (c[0] + r * math.cos(t1), c[1] + r * math.sin(t1))
            parts.append(
                f"{p1[0]:.3f} {p1[1]:.3f} {p2[0]:.3f} {p2[1]:.3f} {p3[0]:.3f} {p3[1]:.3f} c"
            )
            t = t1
        self.ops.append(" ".join(parts) + " S")

    def fill(self, pts: list[Pt]) -> None:
        path = " ".join(f"{x:.3f} {y:.3f} {'m' if i == 0 else 'l'}" for i, (x, y) in enumerate(pts))
        self.ops.append(path + " h f")

    def text(self, s: str, at: Pt, size: float, rot: float = 0.0, center: bool = True) -> None:
        width = 0.5 * size * len(s)
        c, sn = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        x, y = at
        if center:  # el texto se ubica por la izquierda de la línea base
            x -= c * width / 2 - sn * size * 0.35
            y -= sn * width / 2 + c * size * 0.35
        enc = "".join(_escape(ch) for ch in s)
        tm = f"{c:.4f} {sn:.4f} {-sn:.4f} {c:.4f} {x:.3f} {y:.3f}"
        self.ops.append(f"BT /F1 {size:.2f} Tf {tm} Tm ({enc}) Tj ET")

    def bytes(self) -> bytes:
        content = "\n".join(self.ops).encode("latin-1")
        objs = [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {self.w:.2f} {self.h:.2f}] "
                "/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
            ).encode(),
            b"<< /Length "
            + str(len(content)).encode()
            + b" >>\nstream\n"
            + content
            + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        ]
        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = []
        for i, body in enumerate(objs, start=1):
            offsets.append(len(out))
            out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
        xref = len(out)
        out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
        for off in offsets:
            out += f"{off:010d} 00000 n \n".encode()
        out += (
            f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
        )
        return bytes(out)


def _escape(ch: str) -> str:
    if ch in "()\\":
        return "\\" + ch
    code = ch.encode("cp1252", errors="replace")[0]
    return ch if 32 <= code < 127 else f"\\{code:03o}"


def plan_to_pdf(plan: ComplexPlan, scale: int = 50, with_scale_label: bool = True) -> bytes:
    k = PT_PER_M_AT_1 / scale  # puntos por metro del plano
    margin = 2.5
    width = (plan.width_m + 2 * margin) * k
    height = (plan.height_m + 2 * margin) * k
    pdf = _Pdf(width, height)

    def P(p: Pt) -> Pt:  # noqa: N802 - metros (y abajo) → puntos PDF (y arriba)
        return ((p[0] + margin) * k, height - (p[1] + margin) * k)

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
                pdf.line(P(a), P(b), 0.7)
    for w in curved:
        cx, cy, r, a0, a1 = _arc_params(w)
        h = w.thickness / 2
        for rr in (r - h, r + h):
            pdf.arc(P((cx, cy)), rr * k, a0, a1, 0.7)
        for ang in (a0, a1):
            t = math.radians(ang)
            pin = (cx + (r - h) * math.cos(t), cy - (r - h) * math.sin(t))
            pout = (cx + (r + h) * math.cos(t), cy - (r + h) * math.sin(t))
            pdf.line(P(pin), P(pout), 0.7)

    for w in straight:
        ux, uy = (w.b[0] - w.a[0]) / w.length, (w.b[1] - w.a[1]) / w.length
        nx, ny = -uy, ux
        h = w.thickness / 2
        for op in w.openings:
            p0 = (w.a[0] + ux * op.offset, w.a[1] + uy * op.offset)
            p1 = (w.a[0] + ux * (op.offset + op.width), w.a[1] + uy * (op.offset + op.width))
            if op.kind == "window":
                for kk in (-h, 0.0, h):
                    pdf.line(
                        P((p0[0] + nx * kk, p0[1] + ny * kk)),
                        P((p1[0] + nx * kk, p1[1] + ny * kk)),
                        0.25,
                    )
            else:
                leaf = (p0[0] + nx * op.width, p0[1] + ny * op.width)
                pdf.line(P(p0), P(leaf), 0.25)
                a_wall = -math.degrees(math.atan2(uy, ux))
                a_norm = -math.degrees(math.atan2(ny, nx))
                start, end = sorted((a_wall, a_norm))
                if end - start > 180:
                    start, end = end, start + 360
                pdf.arc(P(p0), op.width * k, start, end, 0.25)

    for c in plan.columns:
        if c.round:
            n = 24
            pdf.fill(
                [
                    P(
                        (
                            c.center[0] + c.size / 2 * math.cos(2 * math.pi * i / n),
                            c.center[1] + c.size / 2 * math.sin(2 * math.pi * i / n),
                        )
                    )
                    for i in range(n)
                ]
            )
        else:
            h = c.size / 2
            x, y = c.center
            pdf.fill([P((x - h, y - h)), P((x + h, y - h)), P((x + h, y + h)), P((x - h, y + h))])

    for st in plan.stairs:
        x0, y0, x1, y1 = st.x0, st.y0, st.x1, st.y1
        for a, b in (
            ((x0, y0), (x1, y0)),
            ((x1, y0), (x1, y1)),
            ((x1, y1), (x0, y1)),
            ((x0, y1), (x0, y0)),
        ):
            pdf.line(P(a), P(b), 0.25)
        for i in range(1, st.steps):
            t = i / st.steps
            if st.axis == "x":
                x = x0 + (x1 - x0) * t
                pdf.line(P((x, y0)), P((x, y1)), 0.25)
            else:
                y = y0 + (y1 - y0) * t
                pdf.line(P((x0, y)), P((x1, y)), 0.25)

    for (x0, y0), (x1, y1) in plan.furniture:
        for a, b in (
            ((x0, y0), (x1, y0)),
            ((x1, y0), (x1, y1)),
            ((x1, y1), (x0, y1)),
            ((x0, y1), (x0, y0)),
        ):
            pdf.line(P(a), P(b), 0.2)

    th = 0.2 * k
    for room in plan.rooms:
        c = Polygon(room.polygon).representative_point()
        pdf.text(room.label, P((c.x, c.y - 0.2)), th)
        area = format_dimension(Polygon(room.polygon).area, "m")[0]
        pdf.text(f"A= {area} m²", P((c.x, c.y + 0.25)), th * 0.8)
    c0 = Polygon(plan.rooms[0].polygon).representative_point()
    pdf.text(plan.level_mark, P((c0.x, c0.y + 0.7)), th * 0.8)
    if with_scale_label:
        pdf.text(
            f"PLANTA ARQUITECTÓNICA {plan.scale_label}",
            P((plan.width_m - 3, plan.height_m + 1.4)),
            th,
        )

    tick = 0.1
    for d in plan.dimensions:
        if d.horizontal:
            a, b = (d.a[0], d.at), (d.b[0], d.at)
            ext = [((p[0], d.at + 0.15), (p[0], d.at - 0.15)) for p in (d.a, d.b)]
            rot = 0.0
            tpos = ((a[0] + b[0]) / 2, d.at - 0.18)
        else:
            a, b = (d.at, d.a[1]), (d.at, d.b[1])
            ext = [((d.at + 0.15, p[1]), (d.at - 0.15, p[1])) for p in (d.a, d.b)]
            rot = 90.0
            tpos = (d.at - 0.18, (a[1] + b[1]) / 2)
        pdf.line(P(a), P(b), 0.2)
        for e0, e1 in ext:
            pdf.line(P(e0), P(e1), 0.2)
        for p in (a, b):
            pdf.line(P((p[0] - tick, p[1] + tick)), P((p[0] + tick, p[1] - tick)), 0.5)
        pdf.text(format_dimension(d.value, "m")[0], P(tpos), th * 0.9, rot)
    return pdf.bytes()

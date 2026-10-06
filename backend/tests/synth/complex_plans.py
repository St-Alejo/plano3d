"""Planos sintéticos COMPLEJOS con verdad de terreno: el banco de pruebas de la Fase 0.

Amplía ``plan_generator`` con lo que aparece en planos reales colombianos y que el
pipeline todavía no resuelve:

- muros en **doble línea hueca** (CAD impreso), **achurados**, de **espesores mixtos**,
  **curvos** (arco) y **oblicuos**;
- **columnas**, **escaleras** y **muebles** (ruido que no es muro);
- **cadenas de cotas** con las convenciones locales: ``3,45`` (m con coma), ``345`` (cm),
  ``3⁴⁵`` (superíndice), nivel ``N+0,00``, área ``A= 12,50 m²`` y rótulo ``ESC 1:50``;
- estilo **boceto a mano** (trazo tembloroso);
- una planta **multi-unidad** de decenas de muros.

Toda medida de la verdad de terreno está en metros sobre los EJES de los muros, que es
también la convención del ``BuildingModel``.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Literal

import cv2
import numpy as np
import numpy.typing as npt
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

from tests.synth.plan_generator import (
    INK,
    PAPER,
    Img,
    Pt,
    RenderedPlan,
    SynthOpening,
    SynthPlan,
    SynthRoom,
    SynthWall,
    draw_opening_symbols,
)

WallStyle = Literal["solid", "double", "hatched"]
DimFormat = Literal["m", "cm", "sup"]


# ----------------------------------------------------------------------------- entidades


@dataclass(frozen=True)
class SynthColumn:
    center: Pt
    size: float = 0.3
    round: bool = False


@dataclass(frozen=True)
class SynthStair:
    """Tramo recto: rectángulo (x0, y0)-(x1, y1); sube en el sentido de ``axis``."""

    x0: float
    y0: float
    x1: float
    y1: float
    steps: int
    axis: Literal["x", "y"] = "x"
    riser: float = 0.175

    @property
    def tread(self) -> float:
        run = (self.x1 - self.x0) if self.axis == "x" else (self.y1 - self.y0)
        return abs(run) / self.steps


@dataclass(frozen=True)
class SynthDimension:
    """Cota ortogonal entre dos puntos de eje; la línea de cota se dibuja en ``at``.

    Horizontal si ``a`` y ``b`` comparten y (la línea va en y = ``at``); vertical si comparten x.
    """

    a: Pt
    b: Pt
    at: float

    @property
    def horizontal(self) -> bool:
        return abs(self.a[1] - self.b[1]) < 1e-9

    @property
    def value(self) -> float:
        return abs(self.b[0] - self.a[0]) if self.horizontal else abs(self.b[1] - self.a[1])


@dataclass(frozen=True)
class ComplexPlan(SynthPlan):
    name: str = "complejo"
    columns: tuple[SynthColumn, ...] = ()
    stairs: tuple[SynthStair, ...] = ()
    dimensions: tuple[SynthDimension, ...] = ()
    #: muebles como rectángulos (esquina, esquina) en metros
    furniture: tuple[tuple[Pt, Pt], ...] = ()
    level_mark: str = "N+0,00"
    scale_label: str = "ESC 1:50"


@dataclass(frozen=True)
class Style:
    walls: WallStyle = "solid"
    dims: DimFormat = "m"
    #: amplitud del temblor del trazo, en metros (0 = dibujo de CAD)
    sketch: float = 0.0
    furniture: bool = True

    @property
    def key(self) -> str:
        s = f"{self.walls}-{self.dims}"
        return s + ("-boceto" if self.sketch else "")


# ----------------------------------------------------------------------------- geometría


def wall_polygon(w: SynthWall) -> Polygon:
    """Huella del muro completo (sin aberturas). Los muros rectos se extienden t/2 en los
    extremos para que las esquinas cierren; los curvos llevan extremos planos."""
    h = w.thickness / 2
    if abs(w.bulge) > 1e-9:
        return LineString(w.axis_points()).buffer(h, cap_style="flat", join_style="mitre")
    ux, uy = (w.b[0] - w.a[0]) / w.length, (w.b[1] - w.a[1]) / w.length
    a2 = (w.a[0] - ux * h, w.a[1] - uy * h)
    b2 = (w.b[0] + ux * h, w.b[1] + uy * h)
    return LineString([a2, b2]).buffer(h, cap_style="flat", join_style="mitre")


def wall_pieces_polygons(w: SynthWall) -> list[Polygon]:
    """Tramos sólidos del muro (recortando las aberturas)."""
    full = wall_polygon(w)
    if not w.openings:
        return [full]
    ux, uy = (w.b[0] - w.a[0]) / w.length, (w.b[1] - w.a[1]) / w.length
    holes = []
    for op in w.openings:
        p0 = (w.a[0] + ux * op.offset, w.a[1] + uy * op.offset)
        p1 = (w.a[0] + ux * (op.offset + op.width), w.a[1] + uy * (op.offset + op.width))
        holes.append(LineString([p0, p1]).buffer(w.thickness, cap_style="flat"))
    rest = full.difference(unary_union(holes))
    return list(getattr(rest, "geoms", [rest]))


def _rooms_from_axes(
    walls: tuple[SynthWall, ...], axes: list[tuple[str, list[Pt]]]
) -> tuple[SynthRoom, ...]:
    """Caras interiores exactas: el polígono por ejes menos la huella de los muros."""
    solid = unary_union([wall_polygon(w) for w in walls])
    rooms = []
    for label, pts in axes:
        inner = Polygon(pts).difference(solid)
        if inner.geom_type == "MultiPolygon":
            inner = max(inner.geoms, key=lambda g: g.area)
        inner = inner.simplify(0.005)
        coords = tuple((float(x), float(y)) for x, y in list(inner.exterior.coords)[:-1])
        rooms.append(SynthRoom(label, coords))
    return tuple(rooms)


def _rect(x0: float, y0: float, x1: float, y1: float) -> list[Pt]:
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def dimension_chains(
    xs: list[float], ys: list[float], width: float, height: float
) -> tuple[SynthDimension, ...]:
    """Cadena de cotas parciales + cota total arriba (sobre x) y a la izquierda (sobre y)."""
    dims: list[SynthDimension] = []
    xs = sorted(set([0.0, width, *xs]))
    ys = sorted(set([0.0, height, *ys]))
    for a, b in itertools.pairwise(xs):
        dims.append(SynthDimension((a, 0.0), (b, 0.0), -0.8))
    dims.append(SynthDimension((0.0, 0.0), (width, 0.0), -1.5))
    for a, b in itertools.pairwise(ys):
        dims.append(SynthDimension((0.0, a), (0.0, b), -0.8))
    dims.append(SynthDimension((0.0, 0.0), (0.0, height), -1.5))
    return tuple(dims)


# ----------------------------------------------------------------------------- planos


def casa_compleja() -> ComplexPlan:
    """Casa de 14 x 11 m: muro curvo (bow window), esquina en diagonal, espesores mixtos,
    columna exenta, escalera y cinco ambientes."""
    ext, inn = 0.3, 0.15
    walls = (
        SynthWall(
            (0, 0),
            (14, 0),
            ext,
            (SynthOpening(1.5, 1.5, "window"), SynthOpening(10.5, 1.5, "window")),
        ),
        SynthWall((14, 0), (14, 1.5), ext),
        SynthWall((14, 1.5), (14, 4.5), ext, bulge=-1.2),  # sobresale hacia +x
        SynthWall((14, 4.5), (14, 11), ext, (SynthOpening(3.0, 1.5, "window"),)),
        SynthWall(
            (14, 11),
            (1.5, 11),
            ext,
            (SynthOpening(1.0, 2.0, "window"), SynthOpening(6.5, 1.0, "door")),
        ),
        SynthWall((1.5, 11), (0, 9.5), ext),
        SynthWall((0, 9.5), (0, 0), ext, (SynthOpening(5.5, 1.2, "window"),)),
        SynthWall(
            (5, 0),
            (5, 11),
            inn,
            (SynthOpening(4.0, 0.8, "door"), SynthOpening(7.5, 0.9, "door")),
        ),
        SynthWall((0, 6), (5, 6), inn, (SynthOpening(3.5, 0.8, "door"),)),
        SynthWall((9.5, 0), (9.5, 6), inn, (SynthOpening(4.5, 0.8, "door"),)),
        SynthWall(
            (5, 6),
            (14, 6),
            inn,
            (SynthOpening(1.0, 0.9, "door"), SynthOpening(6.0, 0.9, "door")),
        ),
    )
    bay = walls[2].axis_points()
    axes = [
        ("ALCOBA PPAL", _rect(0, 0, 5, 6)),
        ("ALCOBA 2", [(0, 6), (5, 6), (5, 11), (1.5, 11), (0, 9.5)]),
        ("COCINA", _rect(5, 0, 9.5, 6)),
        ("ESTUDIO", [(9.5, 0), (14, 0), *bay, (14, 6), (9.5, 6)]),
        ("SALA-COMEDOR", _rect(5, 6, 14, 11)),
    ]
    return ComplexPlan(
        width_m=14,
        height_m=11,
        walls=walls,
        rooms=_rooms_from_axes(walls, axes),
        name="casa_compleja",
        columns=(SynthColumn((7.5, 8.5), 0.3), SynthColumn((11.0, 8.5), 0.35, round=True)),
        stairs=(SynthStair(10.0, 9.2, 13.4, 10.6, 12, "x"),),
        dimensions=dimension_chains([5, 9.5], [6, 9.5], 14, 11),
        furniture=(
            ((0.6, 0.6), (2.6, 2.6)),  # cama
            ((6.0, 7.0), (8.0, 7.9)),  # sofá
            ((5.6, 0.4), (9.0, 1.0)),  # mesón
        ),
    )


def multi_unit(units: int = 6) -> ComplexPlan:
    """Edificio de 2·``units`` apartamentos a lado y lado de un corredor central.

    Cada apartamento (6 x 7 m) tiene sala-comedor y alcoba. Espesores mixtos: fachada 0,25,
    medianeras 0,20, tabiques 0,12. Con ``units=6`` son 28 muros y 25 ambientes.
    """
    width, depth = 6.0 * units, 16.0
    fac, med, tab = 0.25, 0.2, 0.12
    top_windows = []
    bottom_windows = []
    for i in range(units):
        x = 6.0 * i
        top_windows += [SynthOpening(x + 1.0, 1.5, "window"), SynthOpening(x + 4.0, 1.2, "window")]
        bottom_windows += [
            SynthOpening(x + 1.0, 1.5, "window"),
            SynthOpening(x + 4.0, 1.2, "window"),
        ]
    walls: list[SynthWall] = [
        SynthWall((0, 0), (width, 0), fac, tuple(top_windows)),
        SynthWall((0, depth), (width, depth), fac, tuple(bottom_windows)),
        SynthWall((0, 0), (0, depth), fac, (SynthOpening(7.5, 1.0, "door"),)),
        SynthWall((width, 0), (width, depth), fac, (SynthOpening(7.4, 1.2, "window"),)),
        SynthWall(
            (0, 7),
            (width, 7),
            med,
            tuple(SynthOpening(6.0 * i + 1.5, 0.9, "door") for i in range(units)),
        ),
        SynthWall(
            (0, 9),
            (width, 9),
            med,
            tuple(SynthOpening(6.0 * i + 1.5, 0.9, "door") for i in range(units)),
        ),
    ]
    axes: list[tuple[str, list[Pt]]] = [("CORREDOR", _rect(0, 7, width, 9))]
    for i in range(units):
        x = 6.0 * i
        if i > 0:
            walls.append(SynthWall((x, 0), (x, 7), med))
            walls.append(SynthWall((x, 9), (x, depth), med))
        walls.append(SynthWall((x + 3.5, 0), (x + 3.5, 7), tab, (SynthOpening(5.0, 0.8, "door"),)))
        walls.append(
            SynthWall((x + 3.5, 9), (x + 3.5, depth), tab, (SynthOpening(1.2, 0.8, "door"),))
        )
        axes += [
            (f"SALA-COMEDOR {i + 1}01", _rect(x, 0, x + 3.5, 7)),
            (f"ALCOBA {i + 1}01", _rect(x + 3.5, 0, x + 6, 7)),
            (f"SALA-COMEDOR {i + 1}02", _rect(x, 9, x + 3.5, depth)),
            (f"ALCOBA {i + 1}02", _rect(x + 3.5, 9, x + 6, depth)),
        ]
    wt = tuple(walls)
    columns = tuple(
        SynthColumn((6.0 * i, y), 0.4) for i in range(units + 1) for y in (0.0, 7.0, 9.0, depth)
    )
    furniture = tuple(
        f
        for i in range(units)
        for f in (
            ((6.0 * i + 4.0, 0.6), (6.0 * i + 5.6, 2.6)),
            ((6.0 * i + 0.6, 13.6), (6.0 * i + 2.8, 14.5)),
        )
    )
    xs = [6.0 * i + d for i in range(units) for d in (0.0, 3.5)]
    return ComplexPlan(
        width_m=width,
        height_m=depth,
        walls=wt,
        rooms=_rooms_from_axes(wt, axes),
        name=f"multi_unit_{units}",
        columns=columns,
        dimensions=dimension_chains(xs, [7.0, 9.0], width, depth),
        furniture=furniture,
        level_mark="N+2,80",
    )


COMPLEX_PLANS = {"casa_compleja": casa_compleja, "multi_unit": multi_unit}

STYLES = {
    "cad": Style("double", "m"),
    "achurado": Style("hatched", "cm"),
    "relleno": Style("solid", "sup"),
    "boceto": Style("solid", "m", sketch=0.04),
}


# ----------------------------------------------------------------------------- texto


def format_dimension(value: float, fmt: DimFormat) -> tuple[str, str]:
    """(texto principal, superíndice) tal como se escribe en un plano colombiano."""
    if fmt == "cm":
        return str(round(value * 100)), ""
    if fmt == "sup":
        cm = round(value * 100)
        return str(cm // 100), f"{cm % 100:02d}"
    return f"{value:.2f}".replace(".", ","), ""


#: fuentes con tildes y "²" (Windows, Debian/Ubuntu); si no hay ninguna se usa la de Pillow
_FONTS = (
    "arial.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
)


def _font(size_px: float) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    size = max(8, round(size_px))
    for name in _FONTS:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def _text_patch(main: str, sup: str, size_px: float) -> Img:
    """Texto negro sobre blanco recortado (escala de grises)."""
    f = _font(size_px)
    fs = _font(size_px * 0.6)
    tmp = Image.new("L", (round(size_px * (len(main) + len(sup) + 2)), round(size_px * 2.2)), 255)
    d = ImageDraw.Draw(tmp)
    d.text((2, round(size_px * 0.6)), main, font=f, fill=INK)
    if sup:
        x = 2 + d.textlength(main, font=f) + 1
        d.text((x, round(size_px * 0.3)), sup, font=fs, fill=INK)
    arr = np.asarray(tmp, np.uint8)
    ys, xs = np.where(arr < 128)
    if len(xs) == 0:
        return arr
    return arr[max(0, ys.min() - 2) : ys.max() + 3, max(0, xs.min() - 2) : xs.max() + 3]


def _stamp(img: Img, patch: Img, center: tuple[float, float], rotate90: bool = False) -> None:
    """Pega texto oscuro (mínimo) centrado en ``center``; girado 90° si es cota vertical."""
    if rotate90:
        patch = np.ascontiguousarray(np.rot90(patch))
    ph, pw = patch.shape
    x0, y0 = round(center[0] - pw / 2), round(center[1] - ph / 2)
    h, w = img.shape[:2]
    xa, ya, xb, yb = max(0, x0), max(0, y0), min(w, x0 + pw), min(h, y0 + ph)
    if xa >= xb or ya >= yb:
        return
    sub = patch[ya - y0 : yb - y0, xa - x0 : xb - x0]
    region = img[ya:yb, xa:xb]
    np.minimum(region, sub[..., None], out=region)


# ----------------------------------------------------------------------------- render


@dataclass
class RenderedComplex(RenderedPlan):
    style: Style = field(default_factory=Style)
    column_mask: Img | None = None
    #: (texto tal cual se dibujó, valor en metros, centro del texto en px)
    dimension_texts: list[tuple[str, float, tuple[float, float]]] = field(default_factory=list)


def render_complex(
    plan: ComplexPlan,
    style: Style = Style(),  # noqa: B008 - Style es inmutable
    px_per_m: float = 60.0,
    margin_m: float = 2.2,
    seed: int = 0,
) -> RenderedComplex:
    w_px = round((plan.width_m + 2 * margin_m) * px_per_m)
    h_px = round((plan.height_m + 2 * margin_m) * px_per_m)
    img = np.full((h_px, w_px, 3), PAPER, np.uint8)
    mask = np.zeros((h_px, w_px), np.uint8)
    col_mask = np.zeros((h_px, w_px), np.uint8)
    r = RenderedComplex(
        plan, img, mask, px_per_m, (margin_m * px_per_m, margin_m * px_per_m), style=style
    )
    thin = max(1, round(px_per_m / 40))
    ink3 = (INK, INK, INK)

    def poly_px(poly: Polygon) -> npt.NDArray[np.int32]:
        return np.round(np.array([r.to_px(p) for p in poly.exterior.coords])).astype(np.int32)

    # 1) huella de muros (la máscara de verdad de terreno) y columnas
    for wall in plan.walls:
        for piece in wall_pieces_polygons(wall):
            cv2.fillPoly(mask, [poly_px(piece)], 255)
    for c in plan.columns:
        if c.round:
            cv2.circle(col_mask, _ip(r.to_px(c.center)), round(c.size / 2 * px_per_m), 255, -1)
        else:
            h = c.size / 2
            sq = Polygon(_rect(c.center[0] - h, c.center[1] - h, c.center[0] + h, c.center[1] + h))
            cv2.fillPoly(col_mask, [poly_px(sq)], 255)

    # 2) dibujo de los muros según el estilo
    if style.walls == "solid":
        img[mask > 0] = ink3
    else:
        contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
        if style.walls == "hatched":
            hatch = np.zeros_like(mask)
            step = max(4, round(px_per_m * 0.12))
            for k in range(-h_px, w_px, step):
                cv2.line(hatch, (k, h_px), (k + h_px, 0), 255, thin)
            img[(hatch > 0) & (mask > 0)] = ink3
        cv2.drawContours(img, contours, -1, ink3, thin + 1, cv2.LINE_AA)
    img[col_mask > 0] = ink3
    r.column_mask = col_mask

    for wall in plan.walls:
        if wall.openings:
            draw_opening_symbols(img, r, wall, thin)

    # 3) escaleras: contorno, huellas y flecha de subida
    for st in plan.stairs:
        a, b = r.to_px((st.x0, st.y0)), r.to_px((st.x1, st.y1))
        cv2.rectangle(img, _ip(a), _ip(b), ink3, thin, cv2.LINE_AA)
        for k in range(1, st.steps):
            t = k / st.steps
            if st.axis == "x":
                x = st.x0 + (st.x1 - st.x0) * t
                cv2.line(img, _ip(r.to_px((x, st.y0))), _ip(r.to_px((x, st.y1))), ink3, thin)
            else:
                y = st.y0 + (st.y1 - st.y0) * t
                cv2.line(img, _ip(r.to_px((st.x0, y))), _ip(r.to_px((st.x1, y))), ink3, thin)
        mid = ((st.y0 + st.y1) / 2) if st.axis == "x" else ((st.x0 + st.x1) / 2)
        p0 = (st.x0, mid) if st.axis == "x" else (mid, st.y0)
        p1 = (st.x1 - 0.2, mid) if st.axis == "x" else (mid, st.y1 - 0.2)
        cv2.arrowedLine(img, _ip(r.to_px(p0)), _ip(r.to_px(p1)), ink3, thin, tipLength=0.08)

    # 4) muebles (trazo fino: no son muros)
    if style.furniture:
        for (x0, y0), (x1, y1) in plan.furniture:
            cv2.rectangle(
                img, _ip(r.to_px((x0, y0))), _ip(r.to_px((x1, y1))), ink3, thin, cv2.LINE_AA
            )
            cv2.line(
                img,
                _ip(r.to_px((x0, y0 + 0.35))),
                _ip(r.to_px((x1, y0 + 0.35))),
                ink3,
                thin,
                cv2.LINE_AA,
            )

    # 5) textos: nombre del ambiente, área, nivel, rótulo
    size = px_per_m * 0.22
    for room in plan.rooms:
        poly = Polygon(room.polygon)
        r.rooms_px.append(np.array([r.to_px(p) for p in room.polygon], np.float64))
        c = poly.representative_point()
        cx, cy = r.to_px((c.x, c.y))
        _stamp(img, _text_patch(room.label, "", size), (cx, cy - size))
        area = f"A= {poly.area:.2f}".replace(".", ",")
        _stamp(img, _text_patch(area + " m²", "", size * 0.8), (cx, cy + size * 0.4))
    c0 = Polygon(plan.rooms[0].polygon).representative_point()
    lx, ly = r.to_px((c0.x, c0.y))
    _stamp(img, _text_patch(plan.level_mark, "", size * 0.8), (lx, ly + size * 1.6))
    tx, ty = r.to_px((plan.width_m - 1.0, plan.height_m + 1.4))
    _stamp(
        img,
        _text_patch(f"PLANTA ARQUITECTÓNICA  {plan.scale_label}", "", size),
        (tx - size * 6, ty),
    )

    # 6) cotas: línea, líneas de extensión, marcas a 45° y valor
    for dim in plan.dimensions:
        _draw_dimension(img, r, dim, style.dims, thin, size)

    if style.sketch > 0:
        _sketchify(r, style.sketch, seed)
    return r


def _draw_dimension(
    img: Img, r: RenderedComplex, dim: SynthDimension, fmt: DimFormat, thin: int, size: float
) -> None:
    ink3 = (INK, INK, INK)
    if dim.horizontal:
        a, b = (dim.a[0], dim.at), (dim.b[0], dim.at)
        ext = [((p[0], dim.at + 0.15), (p[0], dim.at - 0.15)) for p in (dim.a, dim.b)]
    else:
        a, b = (dim.at, dim.a[1]), (dim.at, dim.b[1])
        ext = [((dim.at + 0.15, p[1]), (dim.at - 0.15, p[1])) for p in (dim.a, dim.b)]
    pa, pb = r.to_px(a), r.to_px(b)
    cv2.line(img, _ip(pa), _ip(pb), ink3, thin, cv2.LINE_AA)
    for e0, e1 in ext:
        cv2.line(img, _ip(r.to_px(e0)), _ip(r.to_px(e1)), ink3, thin, cv2.LINE_AA)
    tick = 0.1 * r.px_per_m
    for p in (pa, pb):
        cv2.line(
            img, _ip((p[0] - tick, p[1] + tick)), _ip((p[0] + tick, p[1] - tick)), ink3, thin + 1
        )
    main, sup = format_dimension(dim.value, fmt)
    patch = _text_patch(main, sup, size)
    mx, my = (pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2
    center = (mx, my - size * 0.75) if dim.horizontal else (mx - size * 0.75, my)
    _stamp(img, patch, center, rotate90=not dim.horizontal)
    r.dimension_texts.append((main + (f"^{sup}" if sup else ""), dim.value, center))


def _sketchify(r: RenderedComplex, amount_m: float, seed: int) -> None:
    """Trazo a mano: desplazamiento suave y aleatorio de todo el dibujo (y de la máscara)."""
    rng = np.random.default_rng(seed + 777)
    h, w = r.image.shape[:2]
    amp = amount_m * r.px_per_m
    small = rng.normal(0, 1, (2, max(2, h // 120), max(2, w // 120))).astype(np.float32)
    dx = cv2.resize(small[0], (w, h), interpolation=cv2.INTER_CUBIC) * amp
    dy = cv2.resize(small[1], (w, h), interpolation=cv2.INTER_CUBIC) * amp
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    mx, my = xx + dx, yy + dy
    r.image[:] = cv2.remap(r.image, mx, my, cv2.INTER_LINEAR, borderValue=(PAPER,) * 3)
    r.wall_mask[:] = cv2.remap(r.wall_mask, mx, my, cv2.INTER_NEAREST)


def _ip(p: tuple[float, float]) -> tuple[int, int]:
    return round(p[0]), round(p[1])

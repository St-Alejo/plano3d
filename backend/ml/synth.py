"""Planos sintéticos v2 para entrenar la segmentación de muros.

Cada muestra es (imagen en gris, máscara de muros) con la misma geometría. Lo que importa
enseñarle a la red es lo que las reglas no distinguen: un mueble, un auto o una cota se
dibujan con la MISMA tinta que un muro, pero no son muros. Por eso cada plano lleva:

- planta aleatoria: un rectángulo subdividido en ambientes (a veces en L), muros
  exteriores más gruesos que los interiores, puertas con hoja y arco, ventanas;
- muebles: camas, mesas con sillas, sofás, autos, mesones, inodoros;
- anotaciones: textos, cadenas de cotas, ejes con burbujas, vegetación;
- estilo: técnico (muro macizo, hueco o achurado), CAD oscuro (ya normalizado como lo
  hace el pipeline), render a color (pisos, césped, muebles grises) y baja resolución.

La imagen se entrega como la vería la red en producción: ya pasada a papel claro con
``prepare_sheet`` y a escala de gris.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from itertools import pairwise

import cv2
import numpy as np
import numpy.typing as npt

from plano3d.infrastructure.cv.stages.layout import normalize_dark_sheet

Img = npt.NDArray[np.uint8]
Rng = np.random.Generator

ROOM_WORDS = ["SALA", "COCINA", "BAÑO", "ALCOBA", "ESTUDIO", "COMEDOR", "HALL", "PATIO", "ROPAS"]
STYLES = ("tecnico", "cad_oscuro", "render", "baja_resolucion")


@dataclass
class Wall:
    a: tuple[float, float]
    b: tuple[float, float]
    t: float
    openings: list[tuple[str, float, float]] = field(default_factory=list)  # (tipo, desde, hasta)

    @property
    def horizontal(self) -> bool:
        return abs(self.b[1] - self.a[1]) < 1e-6

    @property
    def length(self) -> float:
        return math.dist(self.a, self.b)


@dataclass
class Plan:
    width: float
    height: float
    walls: list[Wall]
    rooms: list[tuple[float, float, float, float]]
    cut: tuple[float, float, float, float] | None = None  # rincón quitado (planta en L)


# --------------------------------------------------------------------------- geometría


def _split(rect: tuple[float, float, float, float], rng: Rng, depth: int, out: list) -> None:
    x0, y0, x1, y1 = rect
    w, h = x1 - x0, y1 - y0
    if depth == 0 or (w < 4.5 and h < 4.5) or (depth < 3 and rng.random() < 0.2):
        out.append(rect)
        return
    vertical = w > h if abs(w - h) > 1 else rng.random() < 0.5
    if vertical and w >= 4.5:
        x = x0 + w * rng.uniform(0.35, 0.65)
        _split((x0, y0, x, y1), rng, depth - 1, out)
        _split((x, y0, x1, y1), rng, depth - 1, out)
    elif h >= 4.5:
        y = y0 + h * rng.uniform(0.35, 0.65)
        _split((x0, y0, x1, y), rng, depth - 1, out)
        _split((x0, y, x1, y1), rng, depth - 1, out)
    else:
        out.append(rect)


def random_plan(rng: Rng) -> Plan:
    width, height = rng.uniform(7, 16), rng.uniform(6, 14)
    rooms: list[tuple[float, float, float, float]] = []
    _split((0, 0, width, height), rng, 4, rooms)
    ext_t, int_t = rng.uniform(0.15, 0.3), rng.uniform(0.08, 0.15)
    walls: list[Wall] = []
    edges: set[tuple[float, float, float, float]] = set()
    for x0, y0, x1, y1 in rooms:
        for a, b in (
            ((x0, y0), (x1, y0)),
            ((x1, y0), (x1, y1)),
            ((x0, y1), (x1, y1)),
            ((x0, y0), (x0, y1)),
        ):
            key = (round(a[0], 3), round(a[1], 3), round(b[0], 3), round(b[1], 3))
            if key in edges:
                continue
            edges.add(key)
            exterior = (a[1] == b[1] and a[1] in (0, height)) or (
                a[0] == b[0] and a[0] in (0, width)
            )
            w = Wall(a, b, ext_t if exterior else int_t)
            if w.length > 1.6:
                kind = "window" if exterior and rng.random() < 0.7 else "door"
                if exterior and kind == "door" and rng.random() < 0.7:
                    kind = "window"
                size = (
                    rng.uniform(0.8, 0.95)
                    if kind == "door"
                    else rng.uniform(0.6, min(2.4, w.length - 0.6))
                )
                start = rng.uniform(0.3, w.length - size - 0.3)
                if exterior or rng.random() < 0.85:
                    w.openings.append((kind, start, start + size))
            walls.append(w)
    return Plan(width, height, walls, rooms)


# --------------------------------------------------------------------------- dibujo


@dataclass
class Canvas:
    img: Img  # BGR
    mask: Img  # 255 = muro
    ppm: float
    margin: float

    def px(self, p: tuple[float, float]) -> tuple[int, int]:
        return (round((p[0] + self.margin) * self.ppm), round((p[1] + self.margin) * self.ppm))

    def len_px(self, meters: float) -> int:
        return max(1, round(meters * self.ppm))


def _wall_rects(c: Canvas, w: Wall) -> list[np.ndarray]:
    """Rectángulos (px) de los tramos macizos del muro, sin los vanos."""
    cuts = [0.0]
    for _, f, t in sorted(w.openings, key=lambda o: o[1]):
        cuts += [f, t]
    cuts.append(w.length)
    ux, uy = (w.b[0] - w.a[0]) / w.length, (w.b[1] - w.a[1]) / w.length
    nx, ny = -uy, ux
    h = w.t / 2
    rects = []
    for f, t in zip(cuts[::2], cuts[1::2], strict=True):
        if t - f <= 0.01:
            continue
        ext0 = h if f == 0 else 0.0
        ext1 = h if t == w.length else 0.0
        p0 = (w.a[0] + ux * (f - ext0), w.a[1] + uy * (f - ext0))
        p1 = (w.a[0] + ux * (t + ext1), w.a[1] + uy * (t + ext1))
        quad = [
            (p0[0] + nx * h, p0[1] + ny * h),
            (p1[0] + nx * h, p1[1] + ny * h),
            (p1[0] - nx * h, p1[1] - ny * h),
            (p0[0] - nx * h, p0[1] - ny * h),
        ]
        rects.append(np.array([c.px(q) for q in quad], np.int32))
    return rects


def _draw_walls(c: Canvas, plan: Plan, ink: tuple[int, int, int], fill: str, rng: Rng) -> None:
    thin = max(1, c.len_px(0.012))
    for w in plan.walls:
        for r in _wall_rects(c, w):
            cv2.fillPoly(c.mask, [r], 255)
            if fill == "macizo":
                cv2.fillPoly(c.img, [r], ink)
            elif fill == "hueco":
                cv2.polylines(c.img, [r], True, ink, thin)
            else:  # achurado
                cv2.polylines(c.img, [r], True, ink, thin)
                x, y, ww, hh = cv2.boundingRect(r)
                step = max(3, c.len_px(0.06))
                sub = np.zeros_like(c.mask)
                cv2.fillPoly(sub, [r], 255)
                hatch = c.img.copy()
                for k in range(-hh, ww, step):
                    cv2.line(hatch, (x + k, y + hh), (x + k + hh, y), ink, 1)
                c.img[sub > 0] = hatch[sub > 0]
        for kind, f, t in w.openings:
            _draw_opening(c, w, kind, f, t, ink, thin, rng)


def _draw_opening(
    c: Canvas,
    w: Wall,
    kind: str,
    f: float,
    t: float,
    ink: tuple[int, int, int],
    thin: int,
    rng: Rng,
) -> None:
    ux, uy = (w.b[0] - w.a[0]) / w.length, (w.b[1] - w.a[1]) / w.length
    nx, ny = -uy, ux
    a = (w.a[0] + ux * f, w.a[1] + uy * f)
    b = (w.a[0] + ux * t, w.a[1] + uy * t)
    if kind == "window":
        for off in (-w.t / 2, 0.0, w.t / 2):
            p, q = (a[0] + nx * off, a[1] + ny * off), (b[0] + nx * off, b[1] + ny * off)
            cv2.line(c.img, c.px(p), c.px(q), ink, thin)
        return
    side = 1 if rng.random() < 0.5 else -1
    width = t - f
    tip = (a[0] + nx * width * side, a[1] + ny * width * side)
    cv2.line(c.img, c.px(a), c.px(tip), ink, thin)
    ang0 = math.degrees(math.atan2(uy, ux))
    ang1 = math.degrees(math.atan2(ny * side, nx * side))
    lo, hi = sorted((ang0, ang1))
    if hi - lo > 180:
        lo, hi = hi, lo + 360
    cv2.ellipse(c.img, c.px(a), (c.len_px(width), c.len_px(width)), 0, lo, hi, ink, thin)


def _furniture(
    c: Canvas, plan: Plan, ink: tuple[int, int, int], rng: Rng, fill: tuple[int, int, int] | None
) -> None:
    thin = max(1, c.len_px(0.015))
    for x0, y0, x1, y1 in plan.rooms:
        w, h = x1 - x0, y1 - y0
        for _ in range(rng.integers(1, 4)):
            kind = rng.choice(["cama", "mesa", "sofa", "auto", "meson", "inodoro"])
            fw, fh = {
                "cama": (1.4, 2.0),
                "mesa": (1.6, 0.9),
                "sofa": (2.0, 0.85),
                "auto": (1.8, 4.5),
                "meson": (0.6, 2.4),
                "inodoro": (0.4, 0.65),
            }[kind]
            if rng.random() < 0.5:
                fw, fh = fh, fw
            if fw > w - 0.5 or fh > h - 0.5:
                continue
            fx = rng.uniform(x0 + 0.25, x1 - 0.25 - fw)
            fy = rng.uniform(y0 + 0.25, y1 - 0.25 - fh)
            p0, p1 = c.px((fx, fy)), c.px((fx + fw, fy + fh))
            if fill is not None:
                cv2.rectangle(c.img, p0, p1, fill, -1)
            if kind == "auto":
                r = c.len_px(0.35)
                cv2.rectangle(c.img, (p0[0] + r, p0[1]), (p1[0] - r, p1[1]), ink, thin)
                cv2.rectangle(c.img, (p0[0], p0[1] + r), (p1[0], p1[1] - r), ink, thin)
                for k in range(2, 6):  # parabrisas, techo, capó
                    yy = p0[1] + (p1[1] - p0[1]) * k // 7 if fh > fw else None
                    xx = p0[0] + (p1[0] - p0[0]) * k // 7 if fw >= fh else None
                    if yy is not None:
                        cv2.line(c.img, (p0[0] + r, yy), (p1[0] - r, yy), ink, thin)
                    if xx is not None:
                        cv2.line(c.img, (xx, p0[1] + r), (xx, p1[1] - r), ink, thin)
            elif kind == "mesa":
                cv2.rectangle(c.img, p0, p1, ink, thin)
                for k in range(3):
                    cx = p0[0] + (p1[0] - p0[0]) * (k + 1) // 4
                    for cy in (p0[1] - c.len_px(0.3), p1[1] + c.len_px(0.1)):
                        cv2.rectangle(
                            c.img,
                            (cx - c.len_px(0.2), cy),
                            (cx + c.len_px(0.2), cy + c.len_px(0.2)),
                            ink,
                            thin,
                        )
            elif kind == "inodoro":
                cv2.ellipse(
                    c.img,
                    ((p0[0] + p1[0]) // 2, (p0[1] + p1[1]) // 2),
                    (abs(p1[0] - p0[0]) // 2, abs(p1[1] - p0[1]) // 2),
                    0,
                    0,
                    360,
                    ink,
                    thin,
                )
            else:
                cv2.rectangle(c.img, p0, p1, ink, thin)
                if kind == "cama":
                    cv2.rectangle(c.img, p0, (p1[0], p0[1] + c.len_px(0.4)), ink, thin)
                if kind == "sofa":
                    cv2.rectangle(
                        c.img,
                        (p0[0] + c.len_px(0.15), p0[1] + c.len_px(0.15)),
                        (p1[0] - c.len_px(0.15), p1[1] - c.len_px(0.15)),
                        ink,
                        thin,
                    )


def _annotations(c: Canvas, plan: Plan, ink: tuple[int, int, int], rng: Rng, colors: bool) -> None:
    font = cv2.FONT_HERSHEY_SIMPLEX
    scale = max(0.3, c.ppm / 70)
    for x0, y0, _, y1 in plan.rooms:
        if rng.random() < 0.8:
            word = str(rng.choice(ROOM_WORDS)).replace("Ñ", "N")
            cv2.putText(
                c.img, word, c.px((x0 + 0.4, (y0 + y1) / 2)), font, scale, ink, 1, cv2.LINE_AA
            )
    # cadena de cotas arriba y ejes
    axis = (40, 20, 230) if colors else ink
    y = -0.6
    cv2.line(c.img, c.px((0, y)), c.px((plan.width, y)), ink, 1)
    xs = sorted({w.a[0] for w in plan.walls if not w.horizontal})
    for x in xs:
        cv2.line(c.img, c.px((x, y - 0.12)), c.px((x, y + 0.12)), ink, 1)
    for a, b in pairwise(xs):
        cv2.putText(
            c.img,
            f"{b - a:.2f}",
            c.px(((a + b) / 2 - 0.3, y - 0.15)),
            font,
            scale * 0.8,
            ink,
            1,
            cv2.LINE_AA,
        )
    if rng.random() < 0.7:
        for x in xs:
            for k in range(0, int((plan.height + 1.6) * c.ppm), max(4, c.len_px(0.4))):
                p = c.px((x, -1.0))
                cv2.line(
                    c.img, (p[0], p[1] + k), (p[0], p[1] + k + max(2, c.len_px(0.25))), axis, 1
                )
            cv2.circle(c.img, c.px((x, -1.3)), c.len_px(0.25), axis, 1)
    if colors and rng.random() < 0.6:
        for _ in range(rng.integers(1, 4)):  # árboles
            p = c.px((rng.uniform(-0.8, plan.width + 0.8), plan.height + rng.uniform(0.4, 1.2)))
            cv2.circle(c.img, p, c.len_px(rng.uniform(0.3, 0.7)), (40, 200, 40), -1)


def render(plan: Plan, style: str, rng: Rng) -> tuple[Img, Img]:
    """Imagen (gris, como la ve la red) y máscara de muros de un plano."""
    ppm = rng.uniform(18, 70)
    margin = 2.0
    size = (round((plan.height + 2 * margin) * ppm), round((plan.width + 2 * margin) * ppm))
    if style == "cad_oscuro":
        bg, ink = (40, 34, 30), (235, 235, 235)
    else:
        bg, ink = (250, 250, 248), (20, 20, 20)
    img = np.full((*size, 3), bg, np.uint8)
    c = Canvas(img, np.zeros(size, np.uint8), ppm, margin)
    if style == "render":
        for x0, y0, x1, y1 in plan.rooms:
            color = tuple(int(v) for v in rng.integers(150, 235, 3))
            cv2.rectangle(c.img, c.px((x0, y0)), c.px((x1, y1)), color, -1)
        outside = c.img.copy()
        outside[:] = (120, 190, 130)
        inside = np.zeros(size, np.uint8)
        cv2.rectangle(inside, c.px((0, 0)), c.px((plan.width, plan.height)), 255, -1)
        c.img[inside == 0] = outside[inside == 0]
    fill = "macizo" if style == "render" else str(rng.choice(["macizo", "hueco", "achurado"]))
    _furniture(c, plan, ink, rng, (150, 150, 150) if style == "render" else None)
    _draw_walls(c, plan, ink, fill, rng)
    _annotations(c, plan, ink, rng, colors=style == "cad_oscuro")
    out = c.img
    if style == "cad_oscuro":
        out = normalize_dark_sheet(out)
    gray = cv2.cvtColor(out, cv2.COLOR_BGR2GRAY)
    if style == "baja_resolucion":
        f = rng.uniform(0.25, 0.45)
        small = cv2.resize(gray, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
        gray = cv2.resize(small, (gray.shape[1], gray.shape[0]), interpolation=cv2.INTER_NEAREST)
    noise = rng.normal(0, rng.uniform(0, 6), gray.shape)
    gray = np.clip(gray.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    return gray, c.mask


def sample(seed: int, tile: int = 256) -> tuple[Img, Img]:
    """Un recorte (tile x tile) de un plano sintético con su máscara."""
    rng = np.random.default_rng(seed)
    style = STYLES[seed % len(STYLES)]
    gray, mask = render(random_plan(rng), style, rng)
    h, w = gray.shape
    if h < tile or w < tile:
        pad = ((0, max(0, tile - h)), (0, max(0, tile - w)))
        gray = np.pad(gray, pad, constant_values=255)
        mask = np.pad(mask, pad)
        h, w = gray.shape
    # recortes que caigan sobre la casa la mayoría de las veces
    for _ in range(10):
        y, x = rng.integers(0, h - tile + 1), rng.integers(0, w - tile + 1)
        if mask[y : y + tile, x : x + tile].mean() > 5 or rng.random() < 0.1:
            break
    return gray[y : y + tile, x : x + tile].copy(), mask[y : y + tile, x : x + tile].copy()

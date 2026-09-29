"""Generador de planos sintéticos con verdad de terreno (ground truth) exacta.

Permite probar cada etapa del pipeline de visión con métricas objetivas (IoU),
sin depender de fotos reales. Además de dibujar el plano "limpio", simula una
FOTO tomada con el celular: papel sobre una mesa, perspectiva, sombra,
ruido, desenfoque y compresión JPEG.

Convención: metros en el plano, x → derecha, y → abajo (como la imagen).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np
import numpy.typing as npt

Img = npt.NDArray[np.uint8]
Pt = tuple[float, float]

INK = 25
PAPER = 245


@dataclass(frozen=True)
class SynthOpening:
    offset: float  # metros desde el inicio del muro
    width: float
    kind: str = "door"  # "door" | "window"


@dataclass(frozen=True)
class SynthWall:
    a: Pt
    b: Pt
    thickness: float = 0.2
    openings: tuple[SynthOpening, ...] = ()

    @property
    def length(self) -> float:
        return math.dist(self.a, self.b)


@dataclass(frozen=True)
class SynthRoom:
    label: str
    polygon: tuple[Pt, ...]  # caras interiores, en metros


@dataclass(frozen=True)
class SynthPlan:
    width_m: float
    height_m: float
    walls: tuple[SynthWall, ...]
    rooms: tuple[SynthRoom, ...]

    @property
    def door_count(self) -> int:
        return sum(1 for w in self.walls for o in w.openings if o.kind == "door")

    @property
    def window_count(self) -> int:
        return sum(1 for w in self.walls for o in w.openings if o.kind == "window")


def _inner_rect(x0: float, y0: float, x1: float, y1: float, t: float) -> tuple[Pt, ...]:
    h = t / 2
    return ((x0 + h, y0 + h), (x1 - h, y0 + h), (x1 - h, y1 - h), (x0 + h, y1 - h))


def apartment(t: float = 0.2) -> SynthPlan:
    """10 x 7 m, tres ambientes, dos puertas interiores, puerta de entrada y 3 ventanas."""
    walls = (
        SynthWall((0, 0), (10, 0), t, (SynthOpening(2.0, 1.5, "window"),)),
        SynthWall((10, 0), (10, 7), t, (SynthOpening(2.5, 1.2, "window"),)),
        SynthWall((10, 7), (0, 7), t, (SynthOpening(1.5, 1.0, "door"),)),
        SynthWall((0, 7), (0, 0), t, (SynthOpening(1.0, 1.5, "window"),)),
        SynthWall((6, 0), (6, 7), t, (SynthOpening(2.0, 0.9, "door"),)),
        SynthWall((0, 4), (6, 4), t, (SynthOpening(3.5, 0.9, "door"),)),
    )
    rooms = (
        SynthRoom("dormitorio", _inner_rect(0, 0, 6, 4, t)),
        SynthRoom("sala", _inner_rect(0, 4, 6, 7, t)),
        SynthRoom("cocina", _inner_rect(6, 0, 10, 7, t)),
    )
    return SynthPlan(10, 7, walls, rooms)


def l_house(t: float = 0.2) -> SynthPlan:
    """Casa en L de 12 x 9 m con cuatro ambientes."""
    walls = (
        SynthWall((0, 0), (12, 0), t, (SynthOpening(8.0, 2.0, "window"),)),
        SynthWall((12, 0), (12, 5), t),
        SynthWall((12, 5), (6, 5), t, (SynthOpening(2.0, 1.0, "door"),)),
        SynthWall((6, 5), (6, 9), t),
        SynthWall((6, 9), (0, 9), t, (SynthOpening(2.5, 1.5, "window"),)),
        SynthWall((0, 9), (0, 0), t),
        SynthWall((4, 0), (4, 5), t, (SynthOpening(3.0, 0.9, "door"),)),
        SynthWall((0, 5), (6, 5), t, (SynthOpening(1.5, 0.9, "door"),)),
        SynthWall((8, 0), (8, 5), t, (SynthOpening(1.0, 0.9, "door"),)),
    )
    rooms = (
        SynthRoom("dormitorio", _inner_rect(0, 0, 4, 5, t)),
        SynthRoom("sala", _inner_rect(4, 0, 8, 5, t)),
        SynthRoom("cocina", _inner_rect(8, 0, 12, 5, t)),
        SynthRoom("estudio", _inner_rect(0, 5, 6, 9, t)),
    )
    return SynthPlan(12, 9, walls, rooms)


# ----------------------------------------------------------------------------- render


@dataclass
class RenderedPlan:
    plan: SynthPlan
    image: Img  # BGR, papel completo
    wall_mask: Img  # 255 = muro
    px_per_m: float
    origin_px: Pt  # dónde cae el (0,0) del plano en la imagen
    rooms_px: list[npt.NDArray[np.float64]] = field(default_factory=list)

    def to_px(self, p: Pt) -> Pt:
        return (self.origin_px[0] + p[0] * self.px_per_m, self.origin_px[1] + p[1] * self.px_per_m)


def _wall_pieces(w: SynthWall) -> list[tuple[float, float, bool, bool]]:
    """Tramos sólidos (inicio, fin, extender_inicio, extender_fin) en metros."""
    pieces = []
    cursor, ext_start = 0.0, True
    for op in sorted(w.openings, key=lambda o: o.offset):
        pieces.append((cursor, op.offset, ext_start, False))
        cursor, ext_start = op.offset + op.width, False
    pieces.append((cursor, w.length, ext_start, True))
    return [p for p in pieces if p[1] - p[0] > 1e-6]


def render(
    plan: SynthPlan,
    px_per_m: float = 60.0,
    margin_m: float = 1.2,
    with_text: bool = True,
    with_dimensions: bool = True,
) -> RenderedPlan:
    w_px = round((plan.width_m + 2 * margin_m) * px_per_m)
    h_px = round((plan.height_m + 2 * margin_m) * px_per_m)
    img = np.full((h_px, w_px, 3), PAPER, np.uint8)
    mask = np.zeros((h_px, w_px), np.uint8)
    r = RenderedPlan(plan, img, mask, px_per_m, (margin_m * px_per_m, margin_m * px_per_m))

    thin = max(1, round(px_per_m / 40))
    for wall in plan.walls:
        ax, ay = wall.a
        dx, dy = (wall.b[0] - ax) / wall.length, (wall.b[1] - ay) / wall.length
        nx, ny = -dy, dx
        h = wall.thickness / 2
        for s, e, ext_s, ext_e in _wall_pieces(wall):
            s2 = s - (h if ext_s else 0)
            e2 = e + (h if ext_e else 0)
            corners = [
                (ax + dx * s2 + nx * h, ay + dy * s2 + ny * h),
                (ax + dx * e2 + nx * h, ay + dy * e2 + ny * h),
                (ax + dx * e2 - nx * h, ay + dy * e2 - ny * h),
                (ax + dx * s2 - nx * h, ay + dy * s2 - ny * h),
            ]
            poly = np.array([r.to_px(c) for c in corners], np.float64)
            pts = np.round(poly).astype(np.int32)
            cv2.fillPoly(img, [pts], (INK, INK, INK))
            cv2.fillPoly(mask, [pts], 255)
        for op in wall.openings:
            p0 = (ax + dx * op.offset, ay + dy * op.offset)
            p1 = (ax + dx * (op.offset + op.width), ay + dy * (op.offset + op.width))
            if op.kind == "window":
                for k in (-h, 0.0, h):
                    q0 = r.to_px((p0[0] + nx * k, p0[1] + ny * k))
                    q1 = r.to_px((p1[0] + nx * k, p1[1] + ny * k))
                    cv2.line(img, _ip(q0), _ip(q1), (INK,) * 3, thin, cv2.LINE_AA)
            else:
                # hoja de la puerta + arco de giro (hacia el lado +normal)
                hinge = r.to_px(p0)
                leaf_end = r.to_px((p0[0] + nx * op.width, p0[1] + ny * op.width))
                cv2.line(img, _ip(hinge), _ip(leaf_end), (INK,) * 3, thin, cv2.LINE_AA)
                ang0 = math.degrees(math.atan2(dy, dx))
                ang1 = math.degrees(math.atan2(ny, nx))
                if ang1 < ang0:
                    ang0, ang1 = ang1, ang0
                if ang1 - ang0 > 180:
                    ang0, ang1 = ang1, ang0 + 360
                rad = round(op.width * px_per_m)
                cv2.ellipse(
                    img, _ip(hinge), (rad, rad), 0, ang0, ang1, (INK,) * 3, thin, cv2.LINE_AA
                )

    for room in plan.rooms:
        r.rooms_px.append(np.array([r.to_px(p) for p in room.polygon], np.float64))
        if with_text:
            cx = sum(p[0] for p in room.polygon) / len(room.polygon)
            cy = sum(p[1] for p in room.polygon) / len(room.polygon)
            area = _area(room.polygon)
            fs = px_per_m / 110
            org = r.to_px((cx - 0.9, cy))
            cv2.putText(
                img,
                room.label.upper(),
                _ip(org),
                cv2.FONT_HERSHEY_SIMPLEX,
                fs,
                (INK,) * 3,
                thin,
                cv2.LINE_AA,
            )
            org2 = r.to_px((cx - 0.6, cy + 0.5))
            cv2.putText(
                img,
                f"{area:.1f} m2",
                _ip(org2),
                cv2.FONT_HERSHEY_SIMPLEX,
                fs * 0.8,
                (INK,) * 3,
                thin,
                cv2.LINE_AA,
            )

    if with_dimensions:
        y = -0.7
        a, b = r.to_px((0, y)), r.to_px((plan.width_m, y))
        cv2.line(img, _ip(a), _ip(b), (INK,) * 3, thin, cv2.LINE_AA)
        for p in (a, b):
            cv2.line(img, _ip((p[0], p[1] - 8)), _ip((p[0], p[1] + 8)), (INK,) * 3, thin)
        mid = r.to_px((plan.width_m / 2 - 0.4, y - 0.15))
        cv2.putText(
            img,
            f"{plan.width_m:.2f}",
            _ip(mid),
            cv2.FONT_HERSHEY_SIMPLEX,
            px_per_m / 110,
            (INK,) * 3,
            thin,
            cv2.LINE_AA,
        )
    return r


def _ip(p: Pt) -> tuple[int, int]:
    return round(p[0]), round(p[1])


def _area(poly: tuple[Pt, ...]) -> float:
    s = 0.0
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        s += a[0] * b[1] - b[0] * a[1]
    return abs(s) / 2


# ----------------------------------------------------------------------------- photo


@dataclass
class Photo:
    image: Img
    corners: npt.NDArray[np.float64]  # esquinas del papel en la foto: TL, TR, BR, BL
    paper_size: tuple[int, int]  # (ancho, alto) del papel renderizado


def photograph(
    rendered: RenderedPlan,
    seed: int = 0,
    tilt: float = 0.08,
    shadow: float = 0.35,
    noise: float = 6.0,
    blur: float = 1.0,
    jpeg_quality: int = 75,
) -> Photo:
    """Simula una foto del papel sobre una mesa, tomada en ángulo."""
    rng = np.random.default_rng(seed)
    paper = rendered.image
    ph, pw = paper.shape[:2]
    cw, ch = int(pw * 1.35), int(ph * 1.35)
    bg = np.empty((ch, cw, 3), np.uint8)
    bg[:] = (70, 95, 120)  # mesa de madera (BGR)
    grain = rng.normal(0, 12, (ch, cw, 1))
    bg = np.clip(bg.astype(np.float64) + grain, 0, 255).astype(np.uint8)

    cx, cy = cw / 2, ch / 2
    base = np.array(
        [
            [cx - pw / 2, cy - ph / 2],
            [cx + pw / 2, cy - ph / 2],
            [cx + pw / 2, cy + ph / 2],
            [cx - pw / 2, cy + ph / 2],
        ],
        np.float64,
    )
    jitter = rng.uniform(-tilt, tilt, (4, 2)) * np.array([pw, ph])
    dst = base + jitter
    src = np.array([[0, 0], [pw, 0], [pw, ph], [0, ph]], np.float64)
    hom = cv2.getPerspectiveTransform(src.astype(np.float32), dst.astype(np.float32))
    warped = cv2.warpPerspective(paper, hom, (cw, ch), borderValue=(0, 0, 0))
    paper_mask = cv2.warpPerspective(np.full((ph, pw), 255, np.uint8), hom, (cw, ch))
    img = np.where(paper_mask[..., None] > 127, warped, bg)

    # iluminación: gradiente lineal + sombra suave (mano/celular)
    yy, xx = np.mgrid[0:ch, 0:cw].astype(np.float64)
    ang = rng.uniform(0, 2 * math.pi)
    grad = (xx * math.cos(ang) + yy * math.sin(ang)) / max(cw, ch)
    light = 1.0 - shadow * 0.5 * (grad - grad.min()) / (np.ptp(grad) + 1e-9)
    sx, sy = rng.uniform(0.2, 0.8) * cw, rng.uniform(0.2, 0.8) * ch
    blob = np.exp(-(((xx - sx) ** 2 + (yy - sy) ** 2) / (2 * (0.25 * cw) ** 2)))
    light *= 1.0 - shadow * 0.6 * blob
    out = img.astype(np.float64) * light[..., None]
    out += rng.normal(0, noise, out.shape)
    out = np.clip(out, 0, 255).astype(np.uint8)
    if blur > 0:
        out = cv2.GaussianBlur(out, (0, 0), blur)
    ok, enc = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
    assert ok
    decoded = cv2.imdecode(enc, cv2.IMREAD_COLOR)
    assert decoded is not None
    return Photo(decoded, dst, (pw, ph))


def encode(img: Img, ext: str = ".png") -> bytes:
    ok, enc = cv2.imencode(ext, img)
    assert ok
    return enc.tobytes()


def mask_iou(a: Img, b: Img) -> float:
    a_ = a > 127
    b_ = b > 127
    union = np.logical_or(a_, b_).sum()
    return float(np.logical_and(a_, b_).sum() / union) if union else 1.0


def polygon_iou(
    a: npt.NDArray[np.float64], b: npt.NDArray[np.float64], shape: tuple[int, int]
) -> float:
    ma = np.zeros(shape, np.uint8)
    mb = np.zeros(shape, np.uint8)
    cv2.fillPoly(ma, [np.round(a).astype(np.int32)], 255)
    cv2.fillPoly(mb, [np.round(b).astype(np.int32)], 255)
    return mask_iou(ma, mb)

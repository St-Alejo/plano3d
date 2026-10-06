"""Captura de planos grandes (fase 3): control de calidad de la toma y unión de fotos.

- ``check_shot``: nitidez (varianza del laplaciano), reflejos (píxeles saturados en
  manchas), resolución y si se ve la hoja. Devuelve avisos en lenguaje simple.
- ``stitch``: une varias fotos parciales de una hoja A1/A0 en una sola imagen. Cada
  toma se registra contra lo ya unido con rasgos SIFT + homografía RANSAC; la
  tinta se combina tomando el MÍNIMO (lo oscuro de cualquier toma sobrevive), así un
  trazo que en una foto quedó con reflejo se recupera de la otra.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

import cv2
import numpy as np
import numpy.typing as npt

from plano3d.application.ports import CaptureInspector, ImageStitcher, ShotReport
from plano3d.infrastructure.cv.context import Img, as_u8
from plano3d.infrastructure.cv.imageio import decode, encode_png
from plano3d.infrastructure.cv.stages.rectify import find_paper_quad

MIN_SHARPNESS = 60.0
MAX_GLARE = 0.003  # 0,3 % de la imagen quemada en manchas ya tapa cotas
MIN_SIDE = 1200


@dataclass
class ShotCheck:
    sharpness: float
    glare: float
    width: int
    height: int
    paper_found: bool
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.warnings


def check_shot(img: Img) -> ShotCheck:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    h, w = gray.shape
    small = cv2.resize(gray, (min(w, 1600), round(h * min(w, 1600) / w)))
    sharp = float(cv2.Laplacian(small, cv2.CV_64F).var())
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV) if img.ndim == 3 else None
    v = hsv[..., 2] if hsv is not None else gray
    sat = as_u8((v >= 250).astype(np.uint8) * 255)
    # reflejo: manchas saturadas grandes (un papel blanco bien expuesto no satura en manchas)
    n, _, stats, _ = cv2.connectedComponentsWithStats(sat, connectivity=8)
    big = sum(
        int(stats[i, cv2.CC_STAT_AREA]) for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > 400
    )
    glare = big / float(h * w)
    paper = find_paper_quad(img if img.ndim == 3 else as_u8(cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)))
    res = ShotCheck(sharp, glare, w, h, paper is not None)
    if sharp < MIN_SHARPNESS:
        res.warnings.append(
            "La foto está movida o desenfocada: apoya el celular y vuelve a tomarla."
        )
    if glare > MAX_GLARE:
        res.warnings.append(
            "Hay un reflejo de luz sobre el plano: cambia el ángulo o apaga la luz directa."
        )
    if max(w, h) < MIN_SIDE:
        res.warnings.append(
            "La imagen es pequeña: las cotas no se podrán leer. "
            "Acércate o toma el plano por partes."
        )
    return res


Homography = npt.NDArray[np.float64]


def _features(gray: Img, mask: Img | None = None) -> tuple[list[cv2.KeyPoint], np.ndarray | None]:
    sift = cv2.SIFT_create(nfeatures=8000)  # type: ignore[attr-defined]
    return sift.detectAndCompute(gray, mask)  # type: ignore[no-any-return]


def _band(shape: tuple[int, ...], side: str, frac: float = 0.55) -> Img:
    """Máscara de la franja donde se espera el solape (las tomas van en orden)."""
    h, w = shape[:2]
    m = np.zeros((h, w), np.uint8)
    if side == "right":
        m[:, int(w * (1 - frac)) :] = 255
    elif side == "left":
        m[:, : int(w * frac)] = 255
    else:
        m[:] = 255
    return m


def register(base: Img, shot: Img, ordered: bool = True) -> Homography | None:
    """Homografía que lleva ``shot`` sobre ``base`` (None si no hay solape suficiente).

    Con ``ordered`` se buscan rasgos solo en la franja derecha de lo ya unido y en la
    izquierda de la toma nueva: en planos muy repetitivos (edificios de apartamentos
    iguales) evita casar una unidad con su vecina.
    """
    g1 = as_u8(cv2.cvtColor(base, cv2.COLOR_BGR2GRAY))
    g2 = as_u8(cv2.cvtColor(shot, cv2.COLOR_BGR2GRAY))
    k1, d1 = _features(g1, _band(g1.shape, "right" if ordered else "all"))
    k2, d2 = _features(g2, _band(g2.shape, "left" if ordered else "all"))
    if d1 is None or d2 is None or len(k1) < 20 or len(k2) < 20:
        return None
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    pairs = matcher.knnMatch(d2, d1, k=2)
    good = [m for m, *rest in pairs if rest and m.distance < 0.7 * rest[0].distance]
    if len(good) < 25:
        return None
    src = np.array([k2[m.queryIdx].pt for m in good], np.float32).reshape(-1, 1, 2)
    dst = np.array([k1[m.trainIdx].pt for m in good], np.float32).reshape(-1, 1, 2)
    # en un plano repetitivo hay varias alineaciones posibles (una por unidad): se buscan
    # varias candidatas y se elige la que deja la toma nueva A LA DERECHA con un solape
    # razonable (lo que pide la guía de captura)
    candidates: list[tuple[int, Homography]] = []
    keep = np.ones(len(good), bool)
    for _ in range(4):
        if keep.sum() < 25:
            break
        hom, mask = cv2.findHomography(src[keep], dst[keep], cv2.RANSAC, 3.0)
        if hom is None or mask is None or int(mask.sum()) < 20:
            break
        candidates.append((int(mask.sum()), np.asarray(hom, np.float64)))
        idx = np.flatnonzero(keep)
        keep[idx[mask.ravel() > 0]] = False
    if not candidates:
        return None
    if not ordered:
        return max(candidates, key=lambda c: c[0])[1]
    bw = base.shape[1]
    h2, w2 = shot.shape[:2]

    def overlap(hm: Homography) -> float:
        edge = cv2.perspectiveTransform(np.array([[[0, h2 / 2]]], np.float32), hm)[0, 0]
        return float((bw - edge[0]) / max(1, w2))

    plausible = [c for c in candidates if 0.15 <= overlap(c[1]) <= 0.65]
    pool = plausible or candidates
    return max(pool, key=lambda c: c[0])[1]


def stitch(shots: list[Img]) -> Img:
    """Une las tomas sobre la primera. Las que no se puedan registrar se omiten."""
    if not shots:
        raise ValueError("No hay fotos para unir")
    canvas = shots[0].copy()
    offset = np.eye(3)
    for shot in shots[1:]:
        hom = register(canvas, shot)
        if hom is None:
            continue
        h, w = shot.shape[:2]
        corners = cv2.perspectiveTransform(
            np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32).reshape(-1, 1, 2), hom
        ).reshape(-1, 2)
        ch, cw = canvas.shape[:2]
        all_x = np.concatenate([corners[:, 0], [0, cw]])
        all_y = np.concatenate([corners[:, 1], [0, ch]])
        x0, y0 = int(np.floor(all_x.min())), int(np.floor(all_y.min()))
        x1, y1 = int(np.ceil(all_x.max())), int(np.ceil(all_y.max()))
        shift = np.array([[1, 0, -x0], [0, 1, -y0], [0, 0, 1]], np.float64)
        size = (x1 - x0, y1 - y0)
        if size[0] * size[1] > 60_000_000:
            continue  # registro absurdo: la toma no encaja
        white = (255, 255, 255)
        base = cv2.warpPerspective(canvas, shift, size, borderValue=white)
        warped = cv2.warpPerspective(shot, shift @ hom, size, borderValue=white)
        canvas = as_u8(np.minimum(base, warped))
        offset = shift @ offset
    return canvas


class OpenCVCaptureInspector(CaptureInspector):
    def check(self, data: bytes, content_type: str) -> ShotReport:
        img = decode(data, content_type, max_side=3000)
        r = check_shot(img)
        return ShotReport(
            round(r.sharpness, 1),
            round(r.glare, 4),
            r.width,
            r.height,
            r.paper_found,
            tuple(r.warnings),
        )


class OpenCVStitcher(ImageStitcher):
    def stitch(self, images: Sequence[bytes]) -> bytes:
        shots = [decode(b, "image/jpeg", max_side=3000) for b in images]
        return encode_png(stitch(shots))

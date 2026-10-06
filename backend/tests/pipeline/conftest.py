"""Fixtures del pipeline: planos sintéticos, fotos simuladas y mapeo de la verdad de terreno."""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np
import numpy.typing as npt
import pytest

from plano3d.infrastructure.cv.classic_cv_detector import default_stages
from plano3d.infrastructure.cv.context import CVContext
from plano3d.infrastructure.cv.stages.rectify import find_paper_quad
from tests.synth.plan_generator import (
    Photo,
    RenderedPlan,
    SynthPlan,
    apartment,
    encode,
    l_house,
    photograph,
    render,
)

PLANS = {"apartment": apartment, "l_house": l_house}
PHOTO_SEEDS = [0, 1, 2, 3, 4]
INSET = 0.004  # mismo recorte que rectify.warp


@dataclass
class Case:
    """Un plano de entrada + cómo llevar su verdad de terreno a coordenadas rectificadas."""

    name: str
    plan: SynthPlan
    rendered: RenderedPlan
    data: bytes
    content_type: str
    #: homografía papel → imagen rectificada (identidad si es un escaneo limpio)
    to_rectified: npt.NDArray[np.float64]
    photo: Photo | None = None
    #: homografía papel → imagen subida (identidad en un escaneo); compuesta con
    #: ``CVContext.transform`` da la verdad de terreno exacta en la imagen de trabajo
    paper_to_input: npt.NDArray[np.float64] = field(default_factory=lambda: np.eye(3))

    def run(self, until: str | None = None) -> CVContext:
        ctx = CVContext("prj_test", self.data, self.content_type)
        for stage in default_stages():
            ctx = stage.run(ctx)
            if stage.key == until:
                break
        return ctx

    def gt_points(self, pts: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
        p = cv2.perspectiveTransform(pts.reshape(-1, 1, 2), self.to_rectified)
        return np.asarray(p.reshape(-1, 2), np.float64)

    def gt_mask(self, mask: npt.NDArray[np.uint8], shape: tuple[int, int]) -> npt.NDArray[np.uint8]:
        out = cv2.warpPerspective(
            mask, self.to_rectified, (shape[1], shape[0]), flags=cv2.INTER_NEAREST
        )
        return np.asarray(out, np.uint8)


def clean_case(name: str) -> Case:
    return scan_case_from(render(PLANS[name]()), f"{name}-clean")


def photo_case(name: str, seed: int, **photo_params: float) -> Case:
    return photo_case_from(render(PLANS[name]()), f"{name}-photo{seed}", seed, **photo_params)


def scan_case_from(r: RenderedPlan, name: str) -> Case:
    """Escaneo limpio: la imagen rectificada es el papel tal cual."""
    return Case(name, r.plan, r, encode(r.image), "image/png", np.eye(3))


def photo_case_from(r: RenderedPlan, name: str, seed: int, **photo_params: float) -> Case:
    """Foto simulada de cualquier plano renderizado, con la homografía papel → rectificada."""
    photo = photograph(r, seed=seed, **photo_params)  # type: ignore[arg-type]
    ph, pw = r.image.shape[:2]
    paper = np.array([[0, 0], [pw, 0], [pw, ph], [0, ph]], np.float32)
    h_true = cv2.getPerspectiveTransform(paper, photo.corners.astype(np.float32))
    quad = find_paper_quad(photo.image)
    assert quad is not None, "no se detectó la hoja en la foto simulada"
    tl, tr, br, bl = quad
    w = round(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
    h = round(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
    rect = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    h_det = cv2.getPerspectiveTransform(quad.astype(np.float32), rect)
    shift = np.array([[1, 0, -int(w * INSET)], [0, 1, -int(h * INSET)], [0, 0, 1]], np.float64)
    data = encode(photo.image, ".jpg")
    return Case(
        name,
        r.plan,
        r,
        data,
        "image/jpeg",
        shift @ h_det @ h_true,
        photo,
        h_true.astype(np.float64),
    )


ALL_CASES = [f"{n}:clean" for n in PLANS] + [f"{n}:{s}" for n in PLANS for s in PHOTO_SEEDS]


def build_case(spec: str) -> Case:
    name, kind = spec.split(":")
    return clean_case(name) if kind == "clean" else photo_case(name, int(kind))


@pytest.fixture(params=ALL_CASES)
def case(request: pytest.FixtureRequest) -> Case:
    return build_case(request.param)


@pytest.fixture(params=list(PLANS))
def clean(request: pytest.FixtureRequest) -> Case:
    return clean_case(request.param)

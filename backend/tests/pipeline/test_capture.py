"""Captura de planos grandes: unión de varias fotos y control de calidad de la toma."""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from plano3d.infrastructure.cv.capture import check_shot, register, stitch
from tests.synth.complex_plans import STYLES, casa_compleja, multi_unit, render_complex
from tests.synth.plan_generator import photograph, photograph_tiles


def _err(r, shots, k):  # type: ignore[no-untyped-def]
    hom = register(shots[k - 1].image, shots[k].image)
    assert hom is not None
    p = np.array([[[r.image.shape[1] * (0.3 + 0.2 * k), r.image.shape[0] * 0.5]]], np.float32)
    a = cv2.perspectiveTransform(p, shots[k].paper_to_photo)
    b = cv2.perspectiveTransform(p, shots[k - 1].paper_to_photo)
    return float(np.linalg.norm(cv2.perspectiveTransform(a, hom) - b))


@pytest.mark.parametrize("plan", [casa_compleja(), multi_unit(4)], ids=["casa", "edificio"])
def test_registro_subpixel_incluso_en_planos_repetitivos(plan) -> None:  # type: ignore[no-untyped-def]
    r = render_complex(plan, STYLES["cad"])
    shots = photograph_tiles(r, grid=(3, 1), overlap=0.35, seed=2)
    assert _err(r, shots, 1) < 1.0
    assert _err(r, shots, 2) < 1.0


def test_union_cubre_la_hoja() -> None:
    r = render_complex(multi_unit(4), STYLES["cad"])
    shots = photograph_tiles(r, grid=(3, 1), overlap=0.35, seed=2)
    out = stitch([s.image for s in shots])
    # la unión es más ancha que cualquier toma y conserva la tinta (mínimo de las tomas)
    assert out.shape[1] > 2 * shots[0].image.shape[1]
    assert (cv2.cvtColor(out, cv2.COLOR_BGR2GRAY) < 80).mean() > 0.01


def test_avisos_de_calidad() -> None:
    r = render_complex(casa_compleja(), STYLES["cad"])
    good = photograph(r, seed=1, blur=0.6)
    assert check_shot(good.image).sharpness > 60
    blurry = cv2.GaussianBlur(good.image, (0, 0), 6)
    assert any("movida" in w for w in check_shot(blurry).warnings)
    glare = photograph(r, seed=1, glare=0.95).image
    assert any("reflejo" in w for w in check_shot(glare).warnings)
    small = cv2.resize(good.image, None, fx=0.4, fy=0.4)
    assert any("pequeña" in w for w in check_shot(small).warnings)

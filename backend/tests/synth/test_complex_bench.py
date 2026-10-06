"""Banco de pruebas complejo (Fase 0): verdad de terreno coherente y métricas sanas."""

from __future__ import annotations

import math

import numpy as np
import pytest
from shapely.geometry import Polygon

from tests.synth.complex_plans import (
    COMPLEX_PLANS,
    STYLES,
    SynthDimension,
    casa_compleja,
    format_dimension,
    multi_unit,
    render_complex,
)
from tests.synth.metrics import centerline_pr, match_segments, opening_pr, wall_f1
from tests.synth.plan_generator import SynthWall, photograph, photograph_tiles


@pytest.mark.parametrize(
    ("value", "fmt", "expected"),
    [
        (3.45, "m", ("3,45", "")),
        (3.45, "cm", ("345", "")),
        (3.45, "sup", ("3", "45")),
        (14.0, "m", ("14,00", "")),
        (0.9, "sup", ("0", "90")),
    ],
)
def test_formato_de_cotas_colombiano(value: float, fmt: str, expected: tuple[str, str]) -> None:
    assert format_dimension(value, fmt) == expected  # type: ignore[arg-type]


def test_muro_curvo_pasa_por_la_flecha() -> None:
    w = SynthWall((0, 0), (0, 4), 0.2, bulge=-1.0)  # normal izquierda de (0,1) es (-1,0)
    pts = w.axis_points()
    assert pts[0] == pytest.approx((0, 0), abs=1e-9)
    assert pts[-1] == pytest.approx((0, 4), abs=1e-9)
    # el punto más alejado de la cuerda está a 1 m, hacia +x
    far = max(pts, key=lambda p: abs(p[0]))
    assert far[0] == pytest.approx(1.0, abs=0.02)


@pytest.mark.parametrize("name", list(COMPLEX_PLANS))
def test_ambientes_validos_y_sin_solape(name: str) -> None:
    plan = COMPLEX_PLANS[name]()
    polys = [Polygon(r.polygon) for r in plan.rooms]
    assert all(p.is_valid and p.area > 2 for p in polys)
    for i, a in enumerate(polys):
        for b in polys[i + 1 :]:
            assert a.intersection(b).area < 1e-6


def test_multi_unidad_es_grande() -> None:
    plan = multi_unit(6)
    assert len(plan.walls) >= 28
    assert len(plan.rooms) == 25
    assert len({round(w.thickness, 2) for w in plan.walls}) == 3  # espesores mixtos


def test_cadenas_de_cotas_cierran() -> None:
    """Las parciales de cada cadena suman la total: la prueba de consistencia de la Fase 6."""
    plan = casa_compleja()
    for horizontal in (True, False):
        dims = [d for d in plan.dimensions if d.horizontal == horizontal]
        total = max(dims, key=lambda d: d.value)
        parts = [d for d in dims if d is not total]
        assert sum(d.value for d in parts) == pytest.approx(total.value)
    assert SynthDimension((0, 0), (3.45, 0), -1).value == pytest.approx(3.45)


@pytest.mark.parametrize("style", list(STYLES))
def test_render_registra_textos_de_cota(style: str) -> None:
    r = render_complex(casa_compleja(), STYLES[style])
    assert len(r.dimension_texts) == len(r.plan.dimensions)  # type: ignore[attr-defined]
    assert r.wall_mask.any()
    assert r.column_mask is not None and r.column_mask.any()
    # hay tinta en el centro de cada texto de cota
    for _, _, (cx, cy) in r.dimension_texts:
        y, x = round(cy), round(cx)
        assert (r.image[y - 6 : y + 7, x - 15 : x + 16] < 128).any()


def test_estilo_doble_linea_deja_el_muro_hueco() -> None:
    solid = render_complex(casa_compleja(), STYLES["relleno"])
    double = render_complex(casa_compleja(), STYLES["cad"])
    inside = solid.wall_mask > 0
    ink_solid = (solid.image[..., 0] < 128)[inside].mean()
    ink_double = (double.image[..., 0] < 128)[inside].mean()
    assert ink_solid > 0.9
    assert ink_double < 0.7


def test_foto_con_pliegue_y_reflejo_es_reproducible() -> None:
    r = render_complex(casa_compleja(), STYLES["cad"])
    a = photograph(r, seed=3, fold=0.006, glare=0.5)
    b = photograph(r, seed=3, fold=0.006, glare=0.5)
    assert np.array_equal(a.image, b.image)


def test_tomas_parciales_cubren_la_hoja_con_solape() -> None:
    r = render_complex(multi_unit(4), STYLES["cad"])
    shots = photograph_tiles(r, grid=(3, 1), overlap=0.3, seed=1)
    assert len(shots) == 3
    ph, pw = r.image.shape[:2]
    # el centro de la hoja aparece dentro de la toma del medio
    c = np.array([[[pw / 2, ph / 2]]], np.float32)
    import cv2

    p = cv2.perspectiveTransform(c, shots[1].paper_to_photo)[0, 0]
    h, w = shots[1].image.shape[:2]
    assert 0 < p[0] < w and 0 < p[1] < h


def test_metricas_perfectas_contra_si_mismas() -> None:
    segs = [((0.0, 0.0), (10.0, 0.0)), ((10.0, 0.0), (10.0, 5.0))]
    assert wall_f1(segs, segs, 0.1) == 1.0
    assert wall_f1(segs[:1], segs, 0.1) == pytest.approx(2 / 3)
    rev = [(b, a) for a, b in segs]
    assert len(match_segments(rev, segs, 0.1)) == 2
    p, r = centerline_pr([list(s) for s in segs], [list(s) for s in segs], 0.05, 0.1)
    assert p == r == 1.0
    p, r = centerline_pr([[(0.0, 0.0), (5.0, 0.0)]], [list(s) for s in segs], 0.05, 0.1)
    assert p == 1.0 and r == pytest.approx(5 / 15, abs=0.02)
    ops = [((1.0, 0.0), "door"), ((5.0, 0.0), "window")]
    assert opening_pr(ops, ops, 0.2) == (1.0, 1.0)
    assert opening_pr([((1.0, 0.0), "window")], ops[:1], 0.2) == (0.0, 0.0)
    assert math.isclose(opening_pr([], ops, 0.2)[1], 0.0)

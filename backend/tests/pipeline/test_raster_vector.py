"""Ruta raster-vector (ADR-014): vectorización de fotos, cotas leídas y escala."""

from __future__ import annotations

import itertools
import math

import cv2
import numpy as np
import pytest

from plano3d.domain.scale_fit import ScalePair, fit_scale
from plano3d.infrastructure.cv.dimensions import find_dimension_lines
from plano3d.infrastructure.cv.raster_vector_detector import estimate_mpp, run_sync
from plano3d.infrastructure.cv.vectorize import (
    arcs_from_segments,
    hatch_indices,
    skeleton,
    trace_skeleton,
    vectorize,
)
from plano3d.infrastructure.vector.primitives import Line
from tests.pipeline.conftest import scan_case_from
from tests.synth.complex_plans import STYLES, casa_compleja, render_complex


def _poly(pts: list[tuple[float, float]]) -> list[Line]:
    return [Line(a[0], a[1], b[0], b[1]) for a, b in itertools.pairwise(pts)]


def test_esqueleto_de_un_trazo_grueso() -> None:
    img = np.zeros((60, 200), np.uint8)
    cv2.line(img, (20, 30), (180, 30), 255, 7)
    sk = skeleton(img)
    assert (sk > 0).sum(axis=0)[40:160].max() == 1  # 1 px de ancho
    lines = trace_skeleton(sk)
    longest = max(lines, key=lambda ln: ln.length)
    assert longest.length > 140 and abs(longest.y1 - 30) <= 1


def test_un_arco_si_y_una_esquina_no() -> None:
    circle = [
        (100 + 50 * math.cos(math.radians(a)), 100 + 50 * math.sin(math.radians(a)))
        for a in range(0, 91, 15)
    ]
    arcs, _used = arcs_from_segments(_poly(circle))
    assert len(arcs) == 1 and arcs[0].r == pytest.approx(50, abs=1.5)
    # muñón de muro con "ganchos" de esqueleto en las puntas: NO es un arco
    stub = [(731.0, 474.0), (728.0, 480.0), (728.0, 507.0), (730.0, 510.0)]
    assert arcs_from_segments(_poly(stub))[0] == []


def test_achurado_detectado() -> None:
    hatch = [Line(10 + 7 * k, 40, 30 + 7 * k, 20) for k in range(10)]
    walls = [Line(0, 0, 300, 0), Line(0, 60, 300, 60)]
    found = hatch_indices([*walls, *hatch], max_len=35)
    assert found == set(range(2, 12))


def test_escala_robusta() -> None:
    fit = fit_scale(
        [ScalePair(300, 5.0, 1, 1), ScalePair(270, 4.5, 2, 2), ScalePair(90, 5.0, 3, 3)]
    )
    assert fit is not None and fit.meters_per_unit == pytest.approx(1 / 60)


@pytest.fixture(scope="module")
def cad_scan():  # type: ignore[no-untyped-def]
    r = render_complex(casa_compleja(), STYLES["cad"])
    return r, scan_case_from(r, "casa-cad")


def test_lineas_de_cota_con_su_largo(cad_scan) -> None:  # type: ignore[no-untyped-def]
    r, case = cad_scan
    ctx = run_sync("p", case.data, case.content_type, None)
    v = ctx.require(ctx.vec, "vec")
    cv = ctx.require(ctx.cv, "cv")
    dims = find_dimension_lines(v.strokes, cv.require(cv.ink, "ink"), v.stroke_px)
    lengths = [d.line.length / r.px_per_m for d in dims]
    # cada cota del plano aparece como un tramo entre marcas (a 1 %)
    for gt in r.plan.dimensions:
        assert any(abs(L - gt.value) <= 0.01 * gt.value + 0.03 for L in lengths), gt.value


def test_sin_lector_la_escala_es_estimada(cad_scan) -> None:  # type: ignore[no-untyped-def]
    _, case = cad_scan
    ctx = run_sync("p", case.data, case.content_type, None)
    assert ctx.scale_source == "estimated"
    assert ctx.model is not None and ctx.model.levels[0].walls
    assert estimate_mpp(ctx.require(ctx.vec, "vec")) > 0


def test_con_ocr_la_escala_sale_de_las_cotas(cad_scan) -> None:  # type: ignore[no-untyped-def]
    pytest.importorskip("rapidocr_onnxruntime")
    from plano3d.infrastructure.ocr.rapid import RapidOcrReader

    r, case = cad_scan
    ctx = run_sync("p", case.data, case.content_type, RapidOcrReader())
    assert ctx.scale_source == "dimensions"
    true_mpp = 1 / r.px_per_m
    assert ctx.mpp == pytest.approx(true_mpp, rel=0.01)
    model = ctx.require(ctx.model, "model")
    lv = model.levels[0]
    assert len(lv.dimensions) >= 3
    assert len(lv.walls) >= 9
    assert len(lv.rooms) >= 3
    # la incertidumbre de cada medida quedó registrada
    assert all(w.measure.error > 0 for w in lv.walls)


def test_vectoriza_sin_explotar() -> None:
    r = render_complex(casa_compleja(), STYLES["achurado"])
    gray = cv2.cvtColor(r.image, cv2.COLOR_BGR2GRAY)
    ink = np.where(gray < 128, 255, 0).astype(np.uint8)
    v = vectorize(ink)
    assert v.faces  # el achurado se rellenó: los muros tienen caras
    assert len(v.strokes) < 1500

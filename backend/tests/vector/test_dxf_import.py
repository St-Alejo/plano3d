"""Importador DXF (ADR-013): geometría exacta al milímetro contra planos complejos."""

from __future__ import annotations

import math

import pytest

from plano3d.domain import (
    BuildingModel,
    DimensionAxis,
    MeasureSource,
    MeasureStatus,
    OpeningKind,
    RoomType,
    WallKind,
)
from plano3d.infrastructure.vector.builder import VectorContext, vector_stages
from plano3d.infrastructure.vector.detectors import DxfDetector
from plano3d.infrastructure.vector.dxf import DxfReadError, looks_like_dxf, read_dxf
from tests.synth.complex_plans import ComplexPlan, casa_compleja, multi_unit
from tests.synth.metrics import centerline_pr
from tests.synth.to_dxf import plan_to_dxf

VARIANTS = {
    "m": {},
    "cm": {"units": "cm"},
    "mm-sin-unidades": {"units": "mm", "declare_units": False},
    "capa-0": {"layers": False},
    "bloques": {"blocks": True},
}


def run(plan: ComplexPlan, **kw: object) -> tuple[BuildingModel, VectorContext]:
    ctx = VectorContext("prj", plan_to_dxf(plan, **kw), read_dxf)  # type: ignore[arg-type]
    for stage in vector_stages():
        ctx = stage.run(ctx)
    assert ctx.model is not None
    return ctx.model, ctx


def _shift(model: BuildingModel, plan: ComplexPlan) -> tuple[float, float]:
    """El importador agrega un margen: se alinea por el mínimo de los extremos."""
    walls = model.levels[0].walls
    mx = min(min(w.start.x, w.end.x) for w in walls)
    my = min(min(w.start.y, w.end.y) for w in walls)
    gx = min(min(w.a[0], w.b[0]) for w in plan.walls)
    gy = min(min(w.a[1], w.b[1]) for w in plan.walls)
    return mx - gx, my - gy


@pytest.fixture(scope="module", params=["casa", "multi"])
def plan(request: pytest.FixtureRequest) -> ComplexPlan:
    return casa_compleja() if request.param == "casa" else multi_unit(4)


@pytest.mark.parametrize("variant", list(VARIANTS))
def test_reconstruye_el_plano_complejo(plan: ComplexPlan, variant: str) -> None:
    model, _ = run(plan, **VARIANTS[variant])
    lv = model.levels[0]
    ops = [o for w in lv.walls for o in w.openings]
    assert sum(o.kind is OpeningKind.DOOR for o in ops) == plan.door_count
    assert sum(o.kind is OpeningKind.WINDOW for o in ops) == plan.window_count
    assert len(lv.rooms) == len(plan.rooms)
    # cada ambiente con su nombre del plano y con el área exacta que declara el plano
    assert {r.label for r in lv.rooms} == {r.label for r in plan.rooms}
    for r in lv.rooms:
        assert r.declared_area is not None
        assert r.area == pytest.approx(r.declared_area, abs=0.06)
    assert len(lv.columns) == len(plan.columns)
    assert len(lv.dimensions) == len(plan.dimensions)


def test_ejes_al_milimetro(plan: ComplexPlan) -> None:
    model, _ = run(plan)
    dx, dy = _shift(model, plan)
    det = [
        [(p.x - dx, p.y - dy) for p in (w.arc.sample(0.02) if w.arc else (w.start, w.end))]
        for w in model.levels[0].walls
    ]
    gt = [list(w.axis_points(0.02)) for w in plan.walls]
    # los ejes de muros rectos coinciden a 1 mm; los curvos a 1 cm (muestreo del arco)
    p, r = centerline_pr(det, gt, tol=0.011, step=0.05)
    assert p > 0.99 and r > 0.99
    straight_det = [d for d, w in zip(det, model.levels[0].walls, strict=True) if not w.is_curved]
    straight_gt = [list(w.axis_points()) for w in plan.walls if not w.bulge]
    p, r = centerline_pr(straight_det, straight_gt, tol=0.001, step=0.05)
    assert p > 0.99 and r > 0.99


def test_espesores_mixtos_exactos() -> None:
    model, _ = run(multi_unit(4))
    got = sorted({round(w.thickness, 3) for w in model.levels[0].walls})
    assert got == [0.12, 0.2, 0.25]


def test_medidas_exactas_por_vector() -> None:
    model, _ = run(casa_compleja())
    assert model.scale.source == "vector"
    for w in model.levels[0].walls:
        assert w.measure.status is MeasureStatus.EXACT
        assert w.measure.source is MeasureSource.VECTOR


def test_muro_curvo_y_su_flecha() -> None:
    model, _ = run(casa_compleja())
    curved = [w for w in model.levels[0].walls if w.is_curved]
    assert len(curved) == 1
    w = curved[0]
    assert abs(w.bulge) == pytest.approx(1.2, abs=0.01)
    assert w.chord == pytest.approx(3.0, abs=0.01)
    # la flecha sobresale hacia afuera (+x): el punto medio del arco queda 1,2 m a la derecha
    mid = w.point_at(w.length / 2)
    assert mid.x - (w.start.x + w.end.x) / 2 == pytest.approx(1.2, abs=0.01)


def test_tipos_de_muro_y_ambiente() -> None:
    model, _ = run(casa_compleja())
    lv = model.levels[0]
    kinds = {w.kind for w in lv.walls}
    assert WallKind.EXTERIOR in kinds and WallKind.INTERIOR in kinds
    types = {r.label: r.room_type for r in lv.rooms}
    assert types["COCINA"] is RoomType.KITCHEN
    assert types["ALCOBA PPAL"] is RoomType.BEDROOM
    assert types["SALA-COMEDOR"] is RoomType.LIVING


def test_puertas_con_bisagra_y_sentido() -> None:
    model, _ = run(casa_compleja())
    doors = [o for w in model.levels[0].walls for o in w.openings if o.kind is OpeningKind.DOOR]
    assert all(o.operation is not None for o in doors)
    assert {o.opens_left for o in doors} == {True, False}  # abren hacia ambos lados


def test_escalera_y_columnas() -> None:
    model, _ = run(casa_compleja())
    lv = model.levels[0]
    assert len(lv.stairs) == 1
    s = lv.stairs[0]
    assert s.steps == 12
    assert s.tread == pytest.approx(3.4 / 12, abs=0.005)
    assert s.width == pytest.approx(1.4, abs=0.01)
    rounds = [c for c in lv.columns if c.round]
    squares = [c for c in lv.columns if not c.round]
    assert len(rounds) == 1 and rounds[0].width == pytest.approx(0.35, abs=0.02)
    assert len(squares) == 1 and squares[0].width == pytest.approx(0.3, abs=0.005)


def test_cotas_con_su_valor_real() -> None:
    plan = casa_compleja()
    model, _ = run(plan)
    lv = model.levels[0]
    got = sorted(round(d.value, 3) for d in lv.dimensions)
    assert got == sorted(round(d.value, 3) for d in plan.dimensions)
    assert all(d.status is MeasureStatus.EXACT for d in lv.dimensions)
    assert all(abs(d.residual or 0) < 1e-6 for d in lv.dimensions)
    axes = {d.axis for d in lv.dimensions}
    assert axes == {DimensionAxis.HORIZONTAL, DimensionAxis.VERTICAL}


def test_nivel_y_rotulo() -> None:
    model, ctx = run(multi_unit(2))
    assert model.levels[0].elevation == pytest.approx(2.8)
    assert ctx.metrics["scale_denominator"] == 50


def test_vista_previa_coincide_con_la_escala() -> None:
    model, ctx = run(casa_compleja())
    assert ctx.preview is not None
    src = model.source_image
    assert src is not None
    mpp = model.scale.meters_per_pixel
    for w in model.levels[0].walls:
        for p in (w.start, w.end):
            assert 0 <= p.x / mpp <= src.width_px and 0 <= p.y / mpp <= src.height_px


def test_reconoce_dxf() -> None:
    data = plan_to_dxf(casa_compleja())
    assert looks_like_dxf(data)
    assert not looks_like_dxf(b"\x89PNG\r\n")
    d = DxfDetector()
    assert d.accepts("application/dxf", b"")
    assert d.accepts("application/octet-stream", data)
    assert not d.accepts("image/png", data)


def test_dxf_corrupto() -> None:
    with pytest.raises(DxfReadError):
        read_dxf(b"esto no es un dxf")


def test_rendimiento_multi_unidad_grande() -> None:
    import time

    t0 = time.perf_counter()
    model, _ = run(multi_unit(10))
    assert len(model.levels[0].rooms) == 41
    assert time.perf_counter() - t0 < 10
    assert math.isfinite(model.total_area)

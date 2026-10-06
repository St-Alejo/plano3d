"""Importador de PDF vectorial (ADR-013): escala desde las cotas o el rótulo."""

from __future__ import annotations

import pytest

from plano3d.domain import MeasureSource, MeasureStatus
from plano3d.infrastructure.vector.builder import VectorContext, vector_stages
from plano3d.infrastructure.vector.detectors import VectorPdfDetector
from plano3d.infrastructure.vector.pdf import (
    M_PER_PT,
    PdfReadError,
    group_chars,
    is_vector_pdf,
    read_pdf,
)
from tests.synth.complex_plans import ComplexPlan, casa_compleja, multi_unit
from tests.synth.plan_generator import apartment, encode, render
from tests.synth.to_pdf import plan_to_pdf


def run(data: bytes):  # type: ignore[no-untyped-def]
    ctx = VectorContext("prj", data, read_pdf)
    for stage in vector_stages():
        ctx = stage.run(ctx)
    assert ctx.model is not None
    return ctx.model, ctx


@pytest.mark.parametrize("plan", [casa_compleja(), multi_unit(4)], ids=["casa", "multi"])
@pytest.mark.parametrize(
    "kw",
    [{}, {"with_scale_label": False}, {"scale": 100}],
    ids=["1:50", "sin-rotulo", "1:100"],
)
def test_reconstruye_desde_pdf(plan: ComplexPlan, kw: dict[str, object]) -> None:
    model, ctx = run(plan_to_pdf(plan, **kw))  # type: ignore[arg-type]
    lv = model.levels[0]
    assert ctx.drawing is not None and ctx.drawing.exact_scale
    assert len(lv.rooms) == len(plan.rooms)
    for r in lv.rooms:
        assert r.declared_area is not None
        assert r.area == pytest.approx(r.declared_area, abs=0.06)
    ops = [o for w in lv.walls for o in w.openings]
    assert sum(o.kind.value == "door" for o in ops) == plan.door_count
    assert sum(o.kind.value == "window" for o in ops) == plan.window_count
    # las cotas del plano quedan en el modelo con su valor escrito
    assert sorted(round(d.value, 2) for d in lv.dimensions) == sorted(
        round(d.value, 2) for d in plan.dimensions
    )
    assert all(w.measure.status is MeasureStatus.EXACT for w in lv.walls)
    assert all(w.measure.source is MeasureSource.VECTOR for w in lv.walls)


def test_espesores_exactos_desde_pdf() -> None:
    model, _ = run(plan_to_pdf(multi_unit(4)))
    got = sorted({round(w.thickness, 3) for w in model.levels[0].walls})
    assert got == [0.12, 0.2, 0.25]


def test_escala_desde_cotas_sin_rotulo() -> None:
    """Sin "ESC 1:50", la razón metros/punto sale de casar textos de cota con sus líneas."""
    _, ctx = run(plan_to_pdf(casa_compleja(), with_scale_label=False))
    lv = ctx.require(ctx.model, "model").levels[0]
    assert lv.dimensions  # las cotas que fijaron la escala
    w = max(lv.walls, key=lambda w: w.length)
    assert w.length == pytest.approx(14.0, abs=0.002)


def test_reconoce_pdf_vectorial_y_escaneado() -> None:
    vec = plan_to_pdf(casa_compleja())
    assert is_vector_pdf(vec)
    # un PDF con solo una imagen (escaneo) va a la visión clásica
    import io

    from PIL import Image

    img = Image.open(io.BytesIO(encode(render(apartment()).image)))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PDF")
    assert not is_vector_pdf(buf.getvalue())
    d = VectorPdfDetector()
    assert d.accepts("application/pdf", vec)
    assert not d.accepts("application/pdf", buf.getvalue())
    assert not d.accepts("image/png", vec)


def test_textos_rotados_se_leen_completos() -> None:
    chars = []
    # "6,00" escrito de abajo hacia arriba (cota vertical): matriz (0, 1, -1, 0)
    for k, ch in enumerate("6,00"):
        y = 100 - k * 5
        chars.append(
            {
                "text": ch,
                "matrix": (0, 1, -1, 0, 10, 0),
                "x0": 8,
                "x1": 12,
                "top": y - 5,
                "bottom": y,
            }
        )
    phrases = group_chars(chars)
    assert [p.text for p in phrases] == ["6,00"]


def test_pdf_corrupto() -> None:
    with pytest.raises(PdfReadError):
        read_pdf(b"%PDF-1.4 roto")


def test_constante_de_puntos() -> None:
    assert pytest.approx(0.0254) == M_PER_PT * 72

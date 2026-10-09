"""PDF real impreso desde CAD (planta 2 opción 4): plumas, fachadas de una línea,
puertas en un solo trazo y columnas que cortan los muros."""

from __future__ import annotations

from pathlib import Path

import pytest

from plano3d.domain import OpeningKind
from plano3d.infrastructure.vector.builder import VectorContext, vector_stages
from plano3d.infrastructure.vector.pdf import (
    _curve_to_prims,
    read_pdf,
    single_line_faces,
    wall_pen_set,
)
from plano3d.infrastructure.vector.primitives import Line

PDF = Path(__file__).parent.parent / "real" / "planta2" / "plano.pdf"


@pytest.fixture(scope="module")
def model():  # type: ignore[no-untyped-def]
    ctx = VectorContext("prj", PDF.read_bytes(), read_pdf)
    for stage in vector_stages():
        ctx = stage.run(ctx)
    assert ctx.model is not None
    return ctx.model


def test_muros_sin_mobiliario_ni_escalones(model) -> None:  # type: ignore[no-untyped-def]
    lv = model.levels[0]
    # antes: 102 "muros" (peldaños, sanitarios, mesas); el plano tiene ~30 tramos
    assert 20 <= len(lv.walls) <= 40
    xs = [p.x for w in lv.walls for p in (w.start, w.end)]
    # ancho total acotado: 6,60 m entre caras exteriores
    assert max(xs) - min(xs) == pytest.approx(6.60 - 0.12, abs=0.08)


def test_ambientes_con_nombre_y_area(model) -> None:  # type: ignore[no-untyped-def]
    rooms = {r.label: r for r in model.levels[0].rooms}
    for name in ("ALCOBA  1", "ALCOBA  2", "ALCOBA  3", "SALA-COMEDOR"):
        assert name in rooms
    assert len(rooms) >= 7  # + hall de escalera y dos baños

    def size(label: str) -> tuple[float, float]:
        xs = [p.x for p in rooms[label].polygon]
        ys = [p.y for p in rooms[label].polygon]
        return max(xs) - min(xs), max(ys) - min(ys)

    # medidas de las cotas: alcoba (2,84) + nicho del clóset (0,55) por 3,40
    assert size("ALCOBA  2") == pytest.approx((2.84 + 0.55, 3.40), abs=0.03)
    assert size("ALCOBA  3") == pytest.approx((2.91, 3.09 + 0.55), abs=0.03)
    assert size("SALA-COMEDOR")[0] == pytest.approx(3.33, abs=0.03)


def test_puertas_ventanas_y_columnas(model) -> None:  # type: ignore[no-untyped-def]
    lv = model.levels[0]
    ops = [o for w in lv.walls for o in w.openings]
    assert sum(o.kind is OpeningKind.DOOR for o in ops) >= 6
    assert sum(o.kind is OpeningKind.WINDOW for o in ops) >= 6
    assert len(lv.columns) == 15  # malla de 3 por 5


def test_pluma_de_muros_solo_si_se_distingue() -> None:
    thick = [Line(0, i * 10.0, 900, i * 10.0, "pen:1.44") for i in range(3)]
    thin = [Line(0, 5.0, 900, 5.0, "pen:0.60")]
    assert wall_pen_set(thick + thin, 0.0176) == {"pen:1.44"}
    same = [Line(0, i * 10.0, 900, i * 10.0, "pen:0.50") for i in range(4)]
    assert wall_pen_set(same, 0.0176) is None
    near = [Line(0, 0, 900, 0, "pen:0.60"), Line(0, 9, 900, 9, "pen:0.50")]
    assert wall_pen_set(near, 0.0176) is None  # 0,6 / 0,5: no es otra pluma


def test_fachada_de_una_linea_recibe_la_cara_exterior() -> None:
    heavy = [
        Line(0, 0, 4, 0, "pen:1.44"),  # fachada: una sola línea
        Line(0, 2, 4, 2, "pen:1.44"),  # muro interior: dos caras a 0,12
        Line(0, 2.12, 4, 2.12, "pen:1.44"),
        Line(0, 4, 4, 4, "pen:1.44"),  # otra fachada
    ]
    faces = single_line_faces(heavy)
    ys = sorted(round(f.y1, 3) for f in faces)
    assert ys == [-0.12, 4.12]  # hacia afuera, con el espesor del propio plano


def test_puerta_en_un_solo_trazo_da_hoja_y_arco() -> None:
    k = 0.5523  # Bézier de un cuarto de círculo de radio 30 con centro en (0, 0)
    curve = {
        "path": [
            ("m", (0.0, 0.0)),
            ("l", (0.0, -30.0)),
            ("c", (30 * k, -30.0), (30.0, -30 * k), (30.0, 0.0)),
        ]
    }
    arcs, segs = _curve_to_prims(curve, 0.0)
    assert len(arcs) == 1 and arcs[0].r == pytest.approx(30, rel=0.01)
    assert segs == [((0.0, 0.0), (0.0, -30.0))]

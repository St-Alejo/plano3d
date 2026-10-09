"""El modelo a mano de "PLANTA 2do PISO opc 3" respeta las cotas de la lámina."""

import itertools

import pytest
from scripts.modelos.planta_2do_piso_opc3 import (
    ANCHO,
    LARGO,
    MARGEN,
    aligned_model,
    build_model,
    esquinas_recorte,
)

from plano3d.application.dto import BuildingModelDTO, model_from_dto, model_to_dto
from plano3d.domain import OpeningKind, SourceImage


@pytest.fixture(scope="module")
def nivel():
    return build_model().levels[0]


def _room(nivel, label):
    return next(r for r in nivel.rooms if r.label == label)


def _bbox(room):
    xs = [p.x for p in room.polygon]
    ys = [p.y for p in room.polygon]
    return max(xs) - min(xs), max(ys) - min(ys)


def test_envolvente_de_6_60_por_12_60(nivel) -> None:
    xs = [p.x for w in nivel.walls for p in (w.start, w.end)]
    ys = [p.y for w in nivel.walls for p in (w.start, w.end)]
    t = 0.12
    assert min(xs) - t / 2 == pytest.approx(0) and max(xs) + t / 2 == pytest.approx(ANCHO)
    assert min(ys) - t / 2 == pytest.approx(0) and max(ys) + t / 2 == pytest.approx(LARGO)


@pytest.mark.parametrize(
    ("label", "ancho", "largo"),
    [
        ("Cocina", 3.11, 3.00),
        ("Alcoba 3", 2.91, 0.55 + 3.61),
        ("Baño 2", 2.33, 1.20),
        ("Corredor", 0.80, 2.20),
        ("Alcoba 1", 2.85 + 0.55, 3.64),  # con su clóset
    ],
)
def test_ambientes_con_las_cotas_interiores(nivel, label, ancho, largo) -> None:
    assert _bbox(_room(nivel, label)) == pytest.approx((ancho, largo), abs=0.005)


def test_sala_comedor_de_3_33_por_4_28(nivel) -> None:
    sala = _room(nivel, "Sala-comedor")
    assert _bbox(sala)[0] == pytest.approx(3.33)
    assert max(p.y for p in sala.polygon) - 3.12 == pytest.approx(4.28)


def test_vanos_de_las_fachadas(nivel) -> None:
    der = next(w for w in nivel.walls if w.id == "w_fachada_der")
    inf = next(w for w in nivel.walls if w.id == "w_fachada_inf")
    e = 0.06
    assert [(round(o.offset + e, 2), o.width) for o in der.openings] == [
        (0.92, 2.20),
        (4.42, 2.20),
        (7.52, 0.70),
        (8.85, 1.20),
    ]
    assert [(round(o.offset + e, 2), o.width) for o in inf.openings] == [(0.58, 2.0), (3.63, 2.0)]
    assert all(o.kind == OpeningKind.WINDOW for o in (*der.openings, *inf.openings))


def test_una_puerta_por_ambiente(nivel) -> None:
    puertas = [o.id for w in nivel.walls for o in w.openings if o.kind == OpeningKind.DOOR]
    assert sorted(puertas) == sorted(
        ["o_entrada", "o_alcoba3", "o_bano2", "o_alcoba2", "o_bano1", "o_alcoba1"]
    )


def test_columnas_en_los_cruces_de_ejes(nivel) -> None:
    assert len(nivel.columns) == 12
    assert {(c.center.x, c.center.y) for c in nivel.columns} >= {(0.15, 0.15), (5.85, 11.85)}


def test_la_escalera_sube_un_entrepiso(nivel) -> None:
    tramos = nivel.stairs
    assert sum(s.steps for s in tramos) == 16
    ultimo = tramos[-1]
    assert ultimo.base + ultimo.rise == pytest.approx(nivel.height)
    for antes, despues in itertools.pairwise(tramos):
        assert despues.base == pytest.approx(antes.base + antes.rise, abs=1e-3)


def test_el_contrato_lo_lee_igual() -> None:
    m = build_model("p")
    again = model_from_dto(BuildingModelDTO.model_validate_json(model_to_dto(m).model_dump_json()))
    assert again == m


def test_alineado_con_la_foto_rectificada() -> None:
    src = SourceImage("rectified/p.png", 780, 1380)
    m = aligned_model("p", src)
    assert m.scale.meters_per_pixel == pytest.approx((ANCHO + 2 * MARGEN) / 780)
    w = next(w for w in m.levels[0].walls if w.id == "w_fachada_izq")
    assert w.start.x == pytest.approx(MARGEN + 0.06)
    esquinas = esquinas_recorte()
    assert len(esquinas) == 4 and all(0 < v < 1 for c in esquinas for v in c)

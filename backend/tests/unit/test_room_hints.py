"""Ambientes sin rótulo: la escalera por sus huellas, el baño por sus aparatos."""

import math

from shapely.geometry import box

from plano3d.domain import RoomType
from plano3d.domain.plan_text import room_name_from_texts
from plano3d.infrastructure.vector.primitives import ArcPrim, Line
from plano3d.infrastructure.vector.room_hints import hinted_type, tread_count


def treads(n: int, step: float = 0.28, x0: float = 1.0) -> list[Line]:
    """``n`` huellas verticales de 0,85 m, como las dibuja una foto: una cortada y una doble."""
    out = []
    for k in range(n):
        x = x0 + k * step
        top = 1.25 if k == 2 else 1.0  # huella cortada por el texto de una cota
        out.append(Line(x, top, x + 0.01, 1.85))
    out.append(Line(x0 + 0.03, 1.0, x0 + 0.03, 1.85))  # trazo doble de la primera
    return out


def test_las_huellas_parejas_cuentan_aunque_una_salga_cortada() -> None:
    assert tread_count(treads(6)) == 6


def test_lineas_sueltas_o_desparejas_no_son_escalera() -> None:
    bed = [Line(1, 1, 1, 3), Line(2.6, 1, 2.6, 3), Line(1, 1, 2.6, 1), Line(1, 3, 2.6, 3)]
    uneven = [Line(1 + x, 1, 1 + x, 1.85) for x in (0, 0.28, 0.9, 1.1, 1.8)]
    assert tread_count(bed) <= 2
    assert tread_count(uneven) <= 2


def test_un_punto_fijo_sin_rotulo_es_la_escalera() -> None:
    room = box(0.5, 0.5, 3.5, 3.5)
    assert hinted_type(room, treads(6), []) is RoomType.STAIRS


def test_un_cuarto_pequeno_con_sanitario_es_baño() -> None:
    bath = box(0, 0, 1.5, 1.8)
    toilet = ArcPrim(0.75, 1.4, 0.2, 0.0, math.pi)
    assert hinted_type(bath, [], [toilet]) is RoomType.BATHROOM


def test_ni_una_hoja_de_puerta_ni_un_salon_con_lavaplatos_son_baño() -> None:
    small = box(0, 0, 1.5, 1.8)
    leaf = ArcPrim(0.1, 0.1, 0.7, 0.0, math.pi / 2)
    assert hinted_type(small, [], [leaf]) is None
    big = box(0, 0, 4, 4)
    sink = ArcPrim(1.0, 1.0, 0.2, 0.0, 2 * math.pi)
    assert hinted_type(big, [], [sink]) is None


def test_el_numero_pegado_y_el_espacio_abierto() -> None:
    alcoba = room_name_from_texts(["ALCOBA3"])
    assert alcoba is not None and alcoba.label == "Alcoba 3"
    open_plan = room_name_from_texts(["COCINA", "SALA-COMEDOR"])
    assert open_plan is not None and open_plan.room_type is RoomType.KITCHEN
    assert open_plan.label.startswith("Cocina / Sala")

"""Muebles leídos de los trazos del CAD (infrastructure/vector/furniture.py)."""

from __future__ import annotations

import math

import pytest

from plano3d.domain import Point2D, Room, RoomType, Wall
from plano3d.infrastructure.vector.furniture import detect_furniture, find_rects
from plano3d.infrastructure.vector.primitives import ArcPrim, Line


def box(x0: float, y0: float, x1: float, y1: float) -> list[Line]:
    return [Line(x0, y0, x1, y0), Line(x1, y0, x1, y1), Line(x1, y1, x0, y1), Line(x0, y1, x0, y0)]


def room(kind: RoomType, label: str = "", side: float = 4.0) -> Room:
    pts = (Point2D(0, 0), Point2D(side, 0), Point2D(side, side), Point2D(0, side))
    return Room(id="r1", label=label or kind.value, polygon=pts, room_type=kind)


def walls(side: float = 4.0) -> list[Wall]:
    c = [(0, 0), (side, 0), (side, side), (0, side)]
    return [Wall(id=f"w{i}", start=Point2D(*c[i]), end=Point2D(*c[(i + 1) % 4])) for i in range(4)]


def back(rot: float) -> tuple[float, float]:
    """Hacia dónde mira el respaldo en planta (el -z local del mueble)."""
    return round(math.sin(rot), 6) + 0.0, round(-math.cos(rot), 6) + 0.0


def test_un_rectangulo_cerrado_con_tolerancia_de_dibujo() -> None:
    lines = box(1, 1, 2.4, 2.9)
    # un lado partido en dos y un extremo corrido 2 cm: sigue siendo el mismo rectángulo
    lines[1] = Line(2.4, 1, 2.4, 2.0)
    lines.append(Line(2.4, 2.0, 2.4, 2.9))
    lines[0] = Line(1.02, 1, 2.4, 1)
    [r] = find_rects(lines)
    assert (r.w, r.length) == (pytest.approx(1.4, abs=0.03), pytest.approx(1.9, abs=0.03))
    assert (r.cx, r.cy) == (pytest.approx(1.7, abs=0.02), pytest.approx(1.95, abs=0.02))
    # dos paralelas sin lados que las cierren no son un mueble
    assert find_rects([Line(0, 0, 2, 0), Line(0, 1, 2, 1)]) == []


def test_cama_en_la_alcoba_con_la_cabecera_contra_el_muro() -> None:
    [bed] = detect_furniture([room(RoomType.BEDROOM)], walls(), box(1.3, 0.05, 2.7, 1.95))
    assert bed.catalog_id == "cama_doble"
    assert (bed.width, bed.depth) == (pytest.approx(1.4), pytest.approx(1.9))
    assert back(bed.rotation) == (0.0, -1.0)  # el muro de arriba (y = 0)


def test_el_tipo_de_ambiente_decide_que_es_cada_rectangulo() -> None:
    lines = box(1.3, 0.05, 2.7, 1.95)
    # el mismo rectángulo de cama en un baño no es una cama (ni una ducha de 1,9 m)
    assert detect_furniture([room(RoomType.BATHROOM)], walls(), lines) == []
    assert detect_furniture([room(RoomType.OTHER)], walls(), lines) == []


def test_comedor_suelto_suma_las_sillas() -> None:
    [table] = detect_furniture([room(RoomType.LIVING, "SALA")], walls(), box(1.5, 1.5, 2.4, 2.4))
    assert table.catalog_id == "comedor_4"
    assert table.depth == pytest.approx(0.9 + 0.8)


def test_la_estufa_dibujada_arma_el_meson_contra_su_muro() -> None:
    stove = box(1.7, 0.05, 2.3, 0.55)
    [counter] = detect_furniture([room(RoomType.LIVING, "SALA-COMEDOR / COCINA")], walls(), stove)
    assert counter.catalog_id == "cocina_lineal"
    assert counter.width == pytest.approx(1.8)
    assert counter.position.y == pytest.approx(0.3)
    assert back(counter.rotation) == (0.0, -1.0)
    # en una sala sin cocina el mismo recuadro no es nada
    assert detect_furniture([room(RoomType.LIVING, "SALA")], walls(), stove) == []


def test_sanitario_y_lavamanos_por_sus_arcos() -> None:
    arcs = [ArcPrim(1.0, 0.45, 0.2, 0, math.pi), ArcPrim(2.6, 0.35, 0.22, 0, math.pi)]
    found = detect_furniture([room(RoomType.BATHROOM, side=3.0)], walls(3.0), [], arcs)
    assert sorted(f.catalog_id for f in found) == ["lavamanos", "sanitario"]
    for f in found:
        assert back(f.rotation) == (0.0, -1.0)
        assert f.position.y == pytest.approx(f.depth / 2 + 0.06)

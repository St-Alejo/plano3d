"""Puertas entre el extremo de un tabique y un muro transversal (bridge_end_gaps)."""

import math

import cv2
import numpy as np

from plano3d.infrastructure.cv.context import Segment
from plano3d.infrastructure.cv.stages.openings import (
    bridge_end_gaps,
    classify_gap,
    door_swing_evidence,
    merge_openings,
    sliding_door_evidence,
    window_line_evidence,
)

MPP = 0.01  # 1 px = 1 cm


def _canvas() -> np.ndarray:
    return np.zeros((400, 400), np.uint8)


def _walls() -> list[Segment]:
    # muro vertical en x=300; tabique horizontal en y=200 que termina 90 cm antes
    return [Segment(300, 50, 300, 350, 12), Segment(50, 200, 204, 200, 12)]


def test_puerta_con_arco_se_cierra_hasta_el_muro() -> None:
    ink = _canvas()
    cv2.line(ink, (50, 200), (204, 200), 255, 12)
    cv2.line(ink, (300, 50), (300, 350), 255, 12)
    # hoja abierta desde la bisagra (en el tabique) y arco hasta el otro muro
    cv2.line(ink, (205, 200), (205, 290), 255, 1)
    cv2.ellipse(ink, (205, 200), (90, 90), 0, 0, 90, 255, 1)
    out = bridge_end_gaps(_walls(), 12, MPP, ink)
    s = out[1]
    assert math.isclose(s.x2, 300, abs_tol=1)
    assert len(s.openings) == 1
    o = s.openings[0]
    assert o.kind == "door"
    assert 80 <= o.width <= 95


def test_sin_evidencia_no_inventa_aberturas() -> None:
    ink = _canvas()
    cv2.line(ink, (50, 200), (204, 200), 255, 12)
    cv2.line(ink, (300, 50), (300, 350), 255, 12)
    # un mueble junto al muro: tinta cerca, pero sin arco ni línea continua
    cv2.rectangle(ink, (230, 185), (260, 215), 255, 1)
    out = bridge_end_gaps(_walls(), 12, MPP, ink)
    assert math.isclose(out[1].x2, 204, abs_tol=1)
    assert out[1].openings == []


def test_ventana_corrediza_por_linea_continua() -> None:
    ink = _canvas()
    cv2.line(ink, (204, 200), (294, 200), 255, 1)  # línea de la corrediza de jamba a jamba
    assert window_line_evidence(ink, (204, 200), (294, 200), 12) >= 0.9
    out = bridge_end_gaps(_walls(), 12, MPP, ink)
    assert out[1].openings[0].kind == "window"


def test_arco_de_puerta_tiene_evidencia_alta() -> None:
    ink = _canvas()
    cv2.ellipse(ink, (100, 100), (80, 80), 0, 0, 90, 255, 1)
    assert door_swing_evidence(ink, (100, 100), (1.0, 0.0), 80) >= 0.8
    assert door_swing_evidence(_canvas(), (100, 100), (1.0, 0.0), 80) == 0.0


def _hojas_desfasadas(ink: np.ndarray) -> None:
    # dos hojas de corrediza, cada una en media luz y a distinta profundidad del muro
    cv2.rectangle(ink, (100, 194), (205, 197), 255, 1)
    cv2.rectangle(ink, (195, 203), (300, 206), 255, 1)


def test_puerta_corrediza_por_hojas_desfasadas() -> None:
    ink = _canvas()
    _hojas_desfasadas(ink)
    assert sliding_door_evidence(ink, (100, 200), (300, 200), 14) >= 0.9
    assert classify_gap(ink, (100, 200), (300, 200), 14)[0] == "door"


def test_ventana_corrediza_con_alfeizar_sigue_siendo_ventana() -> None:
    ink = _canvas()
    _hojas_desfasadas(ink)
    cv2.line(ink, (100, 199), (300, 199), 255, 1)  # alféizar de jamba a jamba
    cv2.line(ink, (100, 201), (300, 201), 255, 1)
    assert sliding_door_evidence(ink, (100, 200), (300, 200), 14) == 0.0
    assert classify_gap(ink, (100, 200), (300, 200), 14)[0] == "window"


def test_vano_entre_tramos_con_corrediza_queda_marcado() -> None:
    ink = _canvas()
    _hojas_desfasadas(ink)
    walls = [Segment(20, 200, 100, 200, 14), Segment(300, 200, 380, 200, 14)]
    (wall,) = merge_openings(walls, 14, MPP, ink)
    (o,) = wall.openings
    assert (o.kind, o.operation) == ("door", "sliding")

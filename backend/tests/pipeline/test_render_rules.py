"""Reglas para planos tipo render: tramos cortos, fachada, pasos, ventanales y ambientes."""

import cv2
import numpy as np

from plano3d.infrastructure.cv.context import Segment
from plano3d.infrastructure.cv.stages.openings import merge_openings, mullion_count
from plano3d.infrastructure.cv.stages.rooms import closed_wall_mask, find_rooms
from plano3d.infrastructure.cv.stages.walls import vectorize

MPP = 0.02  # 1 px = 2 cm
T = 8


def test_rescata_tramo_corto_alineado_entre_ventanas() -> None:
    mask = np.zeros((300, 300), np.uint8)
    cv2.rectangle(mask, (50, 50), (54, 250), 255, -1)  # muro largo
    cv2.rectangle(mask, (50, 26), (57, 41), 255, -1)  # montante de 15 px más arriba
    cv2.rectangle(mask, (120, 120), (135, 135), 255, -1)  # mueble suelto
    segs = vectorize(mask, T, mask)
    ys = sorted(round(min(s.y1, s.y2)) for s in segs if abs(s.x1 - 53) < 4)
    assert ys[0] < 30  # el montante entra
    assert not any(110 < s.x1 < 140 and 110 < s.y1 < 140 for s in segs)  # el mueble no


def test_vano_sin_trazos_en_fachada_es_ventana() -> None:
    ink = np.zeros((300, 400), np.uint8)
    walls = [
        Segment(50, 50, 120, 50, T),
        Segment(170, 50, 350, 50, T),  # fachada norte con un hueco de 1 m
        Segment(50, 50, 50, 250, T),
        Segment(350, 50, 350, 250, T),
        Segment(50, 250, 350, 250, T),
    ]
    out = merge_openings(walls, T, MPP, ink)
    (north,) = [s for s in out if s.y1 == 50 and s.y2 == 50]
    assert [o.kind for o in north.openings] == ["window"]


def test_vano_ancho_interior_sin_hoja_es_paso_y_no_divide() -> None:
    ink = np.zeros((300, 400), np.uint8)
    walls = [
        Segment(50, 50, 350, 50, T),
        Segment(50, 250, 350, 250, T),
        Segment(50, 50, 50, 250, T),
        Segment(350, 50, 350, 250, T),
        Segment(200, 50, 200, 110, T),  # tabique con un vano de 1,6 m y sin hoja
        Segment(200, 190, 200, 250, T),
    ]
    out = merge_openings(walls, T, MPP, ink)
    (wall,) = [s for s in out if abs(s.x1 - 200) < 1]
    assert [(o.kind, o.operation) for o in wall.openings] == [("door", "none")]
    rooms = find_rooms(closed_wall_mask((300, 400), out, None), 100, 2)
    assert len(rooms) == 1


def test_parantes_cuentan_solo_si_son_delgados() -> None:
    ink = np.zeros((100, 300), np.uint8)
    for x in (100, 150, 200):
        cv2.rectangle(ink, (x, 47), (x + 3, 53), 255, -1)  # parantes del ventanal
    assert mullion_count(ink, (50, 50), (250, 50), T) == 3
    cv2.rectangle(ink, (148, 20), (156, 80), 255, -1)  # un mueble atraviesa el eje
    assert mullion_count(ink, (50, 50), (250, 50), T) == 2


def test_espacio_angosto_no_es_ambiente() -> None:
    walls = np.zeros((300, 300), np.uint8)
    cv2.rectangle(walls, (20, 20), (280, 280), 255, 6)
    cv2.rectangle(walls, (40, 40), (60, 260), 255, 4)  # rendija de ~16 px = 0,32 m
    rooms = find_rooms(walls, 100, 2, min_width_px=0.6 / MPP)
    assert len(rooms) == 1


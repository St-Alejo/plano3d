"""Reglas para planos tipo render: tramos cortos, fachada, pasos, ventanales y ambientes."""

import cv2
import numpy as np

from plano3d.infrastructure.cv.context import Segment
from plano3d.infrastructure.cv.stages.openings import (
    merge_openings,
    mullion_count,
    resolve_empty_gaps,
)
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
    out = resolve_empty_gaps(merge_openings(walls, T, MPP, ink), ink.shape, T)
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
    out = resolve_empty_gaps(merge_openings(walls, T, MPP, ink), ink.shape, T)
    (wall,) = [s for s in out if abs(s.x1 - 200) < 1]
    assert [(o.kind, o.operation) for o in wall.openings] == [("door", "none")]
    rooms = find_rooms(closed_wall_mask((300, 400), out, None, MPP), 100, 2)
    assert len(rooms) == 1


def test_parantes_delgados_y_equiespaciados() -> None:
    ink = np.zeros((100, 300), np.uint8)
    for x in (99, 149, 199):
        cv2.rectangle(ink, (x, 47), (x + 3, 53), 255, -1)  # parantes del ventanal
    assert mullion_count(ink, (50, 50), (250, 50), T) == 3
    cv2.rectangle(ink, (146, 20), (156, 80), 255, -1)  # un mueble atraviesa el eje
    assert mullion_count(ink, (50, 50), (250, 50), T) == 0  # quedan irregulares


def test_juntas_irregulares_no_son_parantes() -> None:
    ink = np.zeros((100, 300), np.uint8)
    for x in (70, 85, 190):
        cv2.rectangle(ink, (x, 48), (x + 2, 52), 255, -1)
    assert mullion_count(ink, (50, 50), (250, 50), T) == 0


def test_espacio_angosto_no_es_ambiente() -> None:
    walls = np.zeros((300, 300), np.uint8)
    cv2.rectangle(walls, (20, 20), (280, 280), 255, 6)
    cv2.rectangle(walls, (40, 40), (60, 260), 255, 4)  # rendija de ~16 px = 0,32 m
    rooms = find_rooms(walls, 100, 2, min_width_px=0.6 / MPP)
    assert len(rooms) == 1


def test_escala_por_puertas_concordantes() -> None:
    from plano3d.infrastructure.cv.context import PxOpening
    from plano3d.infrastructure.cv.stages.scale import scale_from_doors

    doors = [PxOpening(10, w, "door", 0.9) for w in (40, 42, 41)]
    walls = [Segment(0, 0, 400, 0, T, doors), Segment(0, 0, 0, 300, T)]
    mpp = scale_from_doors(walls)
    assert mpp is not None and abs(mpp - 0.85 / 41) < 1e-6
    assert scale_from_doors(walls, prior_mpp=mpp * 3) is None  # contradice demasiado
    assert scale_from_doors([Segment(0, 0, 400, 0, T, doors[:2])]) is None  # pocas


def test_vano_angosto_no_es_puerta() -> None:
    ink = np.zeros((300, 400), np.uint8)
    walls = [Segment(50, 50, 150, 50, T), Segment(175, 50, 350, 50, T)]  # 25 px = 0,5 m
    (wall,) = merge_openings(walls, T, MPP, ink)
    assert [o.kind for o in wall.openings] == ["window"]


def test_tono_quita_muebles_grises_de_un_render() -> None:
    from plano3d.infrastructure.cv.stages.walls import filter_by_tone

    gray = np.full((200, 200), 240, np.uint8)
    mask = np.zeros_like(gray)
    cv2.rectangle(gray, (10, 10), (190, 20), 5, -1)  # muro negro
    cv2.rectangle(mask, (10, 10), (190, 20), 255, -1)
    cv2.rectangle(gray, (60, 100), (120, 115), 115, -1)  # sofá gris
    cv2.rectangle(mask, (60, 100), (120, 115), 255, -1)
    out = filter_by_tone(mask, gray)
    assert out[15, 100] == 255 and out[108, 90] == 0


def test_isla_dentro_de_un_ambiente_no_tumba_los_demas() -> None:
    from plano3d.infrastructure.cv.context import CVContext, PxRoom
    from plano3d.infrastructure.cv.stages.assemble import build_model

    def sq(x0: float, y0: float, x1: float, y1: float) -> PxRoom:
        return PxRoom(np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], float), 0.9, "E")

    ctx = CVContext("p", b"", "image/png")
    ctx.meters_per_pixel = 0.02
    ctx.rooms = [sq(0, 0, 200, 200), sq(50, 50, 100, 100), sq(210, 0, 400, 200)]
    model = build_model(ctx)
    assert len(model.levels[0].rooms) == 2

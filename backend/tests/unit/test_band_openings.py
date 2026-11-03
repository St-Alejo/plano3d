"""Vanos por el peso del trazo: muro grueso, ventana de líneas finas, puerta con su hoja."""

import math

import cv2
import numpy as np

from plano3d.infrastructure.cv.band_openings import band_openings
from plano3d.infrastructure.vector.primitives import ArcPrim
from plano3d.infrastructure.vector.walls import OpeningCand, WallCand

MPP = 0.01  # 1 px = 1 cm
WALL = WallCand(1.0, 1.0, 9.0, 1.0, 0.12)  # muro de 8 m, caras en y = 94 y 106 px


def face(img: np.ndarray, x1: int, x2: int) -> None:
    """Tramo de muro: dos caras de trazo grueso (4 cm), como se dibuja en una lámina."""
    for y in (94, 106):
        cv2.line(img, (x1, y), (x2, y), 255, 4)


def sheet() -> tuple[np.ndarray, list[ArcPrim]]:
    """Muro con una ventana de 1,5 m (x 250-400), una puerta de 0,8 m (x 500-580) con su
    hoja hacia abajo y un vano vacío de 0,9 m (x 700-790)."""
    img = np.zeros((300, 1000), np.uint8)
    for x1, x2 in ((100, 250), (400, 500), (580, 700), (790, 900)):
        face(img, x1, x2)
    for y in (96, 100, 104):  # ventana: tres líneas finas continuas
        cv2.line(img, (250, y), (400, y), 255, 1)
    for x in range(500, 580, 14):  # puerta: dintel discontinuo
        for y in (94, 106):
            cv2.line(img, (x, y), (x + 7, y), 255, 1)
    cv2.line(img, (500, 106), (500, 186), 255, 1)  # hoja abierta a 90°
    cv2.ellipse(img, (500, 106), (80, 80), 0, 0, 90, 255, 1)  # arco de giro
    hinge = ArcPrim(500.0, 106.0, 80.0, 0.0, math.pi / 2)
    return img, [hinge]


def center(o: OpeningCand) -> float:
    return WALL.x1 + o.offset + o.width / 2


def test_ventana_puerta_y_vano_en_su_lugar() -> None:
    img, arcs = sheet()
    (ops,) = band_openings(img, [WALL], MPP, arcs)
    assert [o.kind for o in ops] == ["window", "door", "door"]
    window, door, empty = ops
    assert abs(center(window) - 3.25) < 0.05 and abs(window.width - 1.5) < 0.06
    assert abs(center(door) - 5.4) < 0.05 and abs(door.width - 0.8) < 0.06
    assert abs(center(empty) - 7.45) < 0.05
    assert door.operation == "swing" and empty.operation is None


def test_la_hoja_fija_la_bisagra_y_el_giro() -> None:
    img, arcs = sheet()
    (ops,) = band_openings(img, [WALL], MPP, arcs)
    door = ops[1]
    assert not door.hinge_at_end  # la bisagra está en la jamba de x = 500 (inicio)
    assert door.opens_left  # el arco cae hacia +y: a la izquierda del eje (1, 0)


def test_la_hoja_no_se_come_la_ventana_vecina() -> None:
    """Vano corrido de puerta + ventana sin jamba gruesa entre ambas: la hoja toma su
    ancho junto a la bisagra y el resto queda como ventana."""
    img = np.zeros((300, 1000), np.uint8)
    face(img, 100, 300)
    face(img, 580, 900)
    for x in range(300, 380, 14):
        for y in (94, 106):
            cv2.line(img, (x, y), (x + 7, y), 255, 1)
    for y in (96, 100, 104):
        cv2.line(img, (380, y), (580, y), 255, 1)
    hinge = ArcPrim(300.0, 106.0, 80.0, 0.0, math.pi / 2)
    (ops,) = band_openings(img, [WALL], MPP, [hinge])
    assert [o.kind for o in ops] == ["door", "window"]
    assert abs(center(ops[0]) - 3.4) < 0.05
    assert abs(center(ops[1]) - 4.8) < 0.05


def test_un_muro_entero_no_tiene_vanos() -> None:
    img = np.zeros((300, 1000), np.uint8)
    face(img, 100, 900)
    cv2.putText(img, "12", (400, 90), cv2.FONT_HERSHEY_PLAIN, 1.0, 255, 1)  # cota de grosor
    assert band_openings(img, [WALL], MPP) == [[]]

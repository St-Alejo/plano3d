"""Ambientes desde la máscara de bandas: muros de doble línea, puertas abiertas, muebles."""

import cv2
import numpy as np

from plano3d.infrastructure.cv.band_rooms import band_mask, band_rooms

MPP = 0.01  # 1 px = 1 cm


def wall(img: np.ndarray, x1: int, y1: int, x2: int, y2: int) -> None:
    """Muro de 12 cm dibujado como dos caras finas (como en una lámina impresa)."""
    if y1 == y2:
        for dy in (-6, 6):
            cv2.line(img, (x1, y1 + dy), (x2, y2 + dy), 255, 2)
    else:
        for dx in (-6, 6):
            cv2.line(img, (x1 + dx, y1), (x2 + dx, y2), 255, 2)


def two_rooms_with_door() -> np.ndarray:
    """Dos ambientes de 4 x 4 m unidos por una puerta de 0,75 m; una cama y una cota."""
    img = np.zeros((600, 1000), np.uint8)
    wall(img, 100, 100, 900, 100)
    wall(img, 100, 500, 900, 500)
    wall(img, 100, 100, 100, 500)
    wall(img, 900, 100, 900, 500)
    wall(img, 500, 100, 500, 262)  # tabique con vano de 262 a 338 (0,75 m libres)
    wall(img, 500, 338, 500, 500)
    cv2.rectangle(img, (150, 150), (310, 350), 255, 2)  # cama: trazo suelto
    cv2.line(img, (60, 550), (940, 550), 255, 1)  # cota exterior
    return img


def test_la_banda_conserva_los_muros_y_borra_los_trazos_sueltos() -> None:
    band = band_mask(two_rooms_with_door(), MPP)
    assert band[100, 300] == 255  # entre las dos caras del muro: relleno
    assert band[150, 230] == 0  # borde de la cama
    assert band[550, 500] == 0  # cota


def test_la_puerta_separa_dos_ambientes() -> None:
    rooms = band_rooms(two_rooms_with_door(), MPP)
    assert len(rooms) == 2
    for r in rooms:
        assert 14.0 < r.area < 16.0  # 3,88 x 3,88 m libres; la cama no resta
    assert not rooms[0].intersects(rooms[1].buffer(-0.02))


def test_un_contacto_ancho_no_es_puerta() -> None:
    """Un vano de 2 m (sala-comedor) o los peldaños de una escalera no dividen."""
    img = np.zeros((600, 1000), np.uint8)
    wall(img, 100, 100, 900, 100)
    wall(img, 100, 500, 900, 500)
    wall(img, 100, 100, 100, 500)
    wall(img, 900, 100, 900, 500)
    wall(img, 500, 100, 500, 150)  # vano de 150 a 350
    wall(img, 500, 350, 500, 500)
    rooms = band_rooms(img, MPP)
    assert len(rooms) == 1
    assert rooms[0].area > 28.0

"""Ambientes desde la máscara de bandas: muros de doble línea, puertas abiertas, muebles."""

import cv2
import numpy as np

from plano3d.infrastructure.cv.band_rooms import band_mask, band_rooms

MPP = 0.01  # 1 px = 1 cm


def wall(img: np.ndarray, x1: int, y1: int, x2: int, y2: int, half: int = 6) -> None:
    """Muro de 12 cm (``half`` = 6 px) dibujado como dos caras finas, como en una lámina."""
    if y1 == y2:
        for dy in (-half, half):
            cv2.line(img, (x1, y1 + dy), (x2, y2 + dy), 255, 2)
    else:
        for dx in (-half, half):
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


def bedroom_with_strip() -> np.ndarray:
    """Alcoba de 4 x 4 m con una "pared" a 1 m del fondo que deja un paso de 0,75 m: puede
    ser un tabique con su puerta o una cota dibujada sobre el pie de la cama."""
    img = np.zeros((600, 600), np.uint8)
    wall(img, 100, 100, 500, 100)
    wall(img, 100, 500, 500, 500)
    wall(img, 100, 100, 100, 500)
    wall(img, 500, 100, 500, 500)
    wall(img, 100, 400, 418, 400)  # paso libre de ~0,75 m junto al muro derecho
    return img


def test_un_nicho_sin_hoja_de_puerta_es_del_ambiente() -> None:
    far_door = [(120.0, 120.0, 70.0)]  # hay arcos en el dibujo, pero lejos de ese paso
    rooms = band_rooms(bedroom_with_strip(), MPP, arcs=far_door)
    assert len(rooms) == 1
    assert rooms[0].area > 14.0


def test_con_la_hoja_dibujada_el_paso_es_una_puerta() -> None:
    door = [(418.0, 400.0, 75.0)]  # bisagra en la punta del tabique, hoja de 0,75 m
    assert len(band_rooms(bedroom_with_strip(), MPP, arcs=door)) == 2


def test_una_cota_reconocida_no_divide() -> None:
    img = bedroom_with_strip()
    cv2.line(img, (100, 394), (418, 394), 255, 2)  # la "pared" es una cota y la cama
    cv2.line(img, (100, 406), (418, 406), 0, 2)
    rooms = band_rooms(img, MPP, dim_lines=[(100.0, 394.0, 418.0, 394.0)])
    assert len(rooms) == 1


def test_la_ducha_se_une_al_bano() -> None:
    """Baño de 2 x 1,6 m con la ducha (0,8 x 1,2 m: chica para ser ambiente) tras una
    división de 8 cm."""
    img = np.zeros((400, 400), np.uint8)
    wall(img, 100, 100, 300, 100)
    wall(img, 100, 260, 300, 260)
    wall(img, 100, 100, 100, 260)
    wall(img, 300, 100, 300, 260)
    wall(img, 190, 100, 190, 230, half=4)
    wall(img, 100, 230, 190, 230, half=4)
    rooms = band_rooms(img, MPP)
    assert len(rooms) == 1
    assert rooms[0].area > 2.4

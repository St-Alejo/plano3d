"""Muros desde la máscara de bandas: ejes rectos entre ambientes, sin cotas ni muebles."""

import cv2
import numpy as np

from plano3d.infrastructure.cv.band_rooms import band_rooms, wall_band
from plano3d.infrastructure.cv.band_walls import band_walls
from plano3d.infrastructure.vector.walls import OpeningCand, WallCand
from tests.unit.test_band_rooms import MPP, two_rooms_with_door


def walls_of(img: np.ndarray, old: list[WallCand] | None = None) -> list[WallCand]:
    rooms = band_rooms(img, MPP)
    return band_walls(wall_band(img, MPP), rooms, MPP, old or [])


def axis_near(walls: list[WallCand], x1: float, y1: float, x2: float, y2: float) -> WallCand:
    for w in walls:
        ends = sorted([(round(w.x1, 1), round(w.y1, 1)), (round(w.x2, 1), round(w.y2, 1))])
        want = sorted([(x1, y1), (x2, y2)])
        pairs = zip(ends, want, strict=True)
        if all(abs(a - b) <= 0.1 for p, q in pairs for a, b in zip(p, q, strict=True)):
            return w
    raise AssertionError(f"no hay muro de {(x1, y1)} a {(x2, y2)}: {[(w.p1, w.p2) for w in walls]}")


def test_cinco_ejes_y_ninguno_de_la_cota_ni_de_la_cama() -> None:
    walls = walls_of(two_rooms_with_door())
    assert len(walls) == 5  # 4 exteriores + el tabique (unido a través de la puerta)
    axis_near(walls, 1.0, 1.0, 9.0, 1.0)
    axis_near(walls, 1.0, 5.0, 9.0, 5.0)
    axis_near(walls, 1.0, 1.0, 1.0, 5.0)
    axis_near(walls, 9.0, 1.0, 9.0, 5.0)
    w = axis_near(walls, 5.0, 1.0, 5.0, 5.0)
    assert 0.1 <= w.thickness <= 0.2


def test_la_puerta_vieja_pasa_al_muro_nuevo() -> None:
    old = WallCand(5.0, 1.0, 5.0, 5.0, 0.12, openings=[OpeningCand(1.62, 0.76, "door")])
    walls = walls_of(two_rooms_with_door(), [old])
    w = axis_near(walls, 5.0, 1.0, 5.0, 5.0)
    assert len(w.openings) == 1
    o = w.openings[0]
    center = w.y1 + (o.offset + o.width / 2) * w.direction[1]
    assert abs(center - 3.0) < 0.05  # sigue en el mismo lugar del plano


def test_una_columna_embebida_no_corta_el_muro() -> None:
    img = two_rooms_with_door()
    for x in (300, 700):
        cv2.rectangle(img, (x - 15, 85), (x + 15, 115), 255, -1)  # columnas de 30 cm
    walls = walls_of(img)
    assert len(walls) == 5
    axis_near(walls, 1.0, 1.0, 9.0, 1.0)  # el muro norte sigue entero y en su eje


def test_un_mueble_dibujado_no_es_muro() -> None:
    img = two_rooms_with_door()
    cv2.rectangle(img, (700, 107), (880, 160), 255, 2)  # mesón: solo su contorno
    walls = walls_of(img)
    assert len(walls) == 5

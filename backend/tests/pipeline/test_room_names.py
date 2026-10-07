"""Nombres de ambientes leídos de la hoja (RoomNamesStage / name_rooms)."""

import numpy as np

from plano3d.application.ports import SpottedText
from plano3d.infrastructure.cv.context import PxRoom
from plano3d.infrastructure.cv.stages.room_names import name_rooms


def _room(x0: float, y0: float, x1: float, y1: float) -> PxRoom:
    poly = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], np.float64)
    return PxRoom(poly, 0.9, "Espacio")


def test_cada_ambiente_toma_el_texto_que_tiene_dentro() -> None:
    rooms = [_room(0, 0, 100, 100), _room(100, 0, 300, 100), _room(0, 100, 100, 200)]
    texts = [
        SpottedText("BAÑO", 0.99, 50, 40, 10),
        SpottedText("BATHROOM", 0.99, 50, 55, 10),
        SpottedText("SALA", 0.99, 200, 80, 10),  # en orden de lectura va después de COCINA
        SpottedText("COCINA", 0.99, 200, 20, 10),
        SpottedText("2.40", 0.99, 60, 150, 10),  # una cota no es un nombre
    ]
    out = name_rooms(rooms, texts)
    assert [r.label for r in out] == ["Baño", "Cocina / Sala", "Espacio"]

"""Cotas "texto primero" (fotos de celular): se mide la línea bajo cada número leído."""

import itertools
import math

import cv2
import numpy as np
import pytest

from plano3d.application.ports import SpottedText, TextSpotter
from plano3d.infrastructure.cv.dimension_text import measure_text, read_text_dimensions


def _ink(h: int = 300, w: int = 600) -> np.ndarray:
    return np.zeros((h, w), np.uint8)


def _tick(ink: np.ndarray, x: int, y: int, size: int = 3) -> None:
    """Tick a 45° pequeño, como los de una lámina fotografiada (4-5 px)."""
    cv2.line(ink, (x - size, y + size), (x + size, y - size), 255, 1)


def _text_blob(ink: np.ndarray, cx: int, cy: int, w: int, h: int) -> None:
    """Manchas de "caracteres" pegadas a la línea, como un número que la toca."""
    for k in range(4):
        x0 = cx - w // 2 + k * w // 4
        cv2.rectangle(ink, (x0, cy - h // 2), (x0 + w // 6, cy + h // 2), 255, -1)


def test_mide_entre_los_ticks_aunque_el_texto_toque_la_linea() -> None:
    ink = _ink()
    cv2.line(ink, (100, 150), (400, 150), 255, 1)
    _tick(ink, 100, 150)
    _tick(ink, 400, 150)
    _text_blob(ink, 250, 143, 30, 8)  # el texto llega hasta la línea
    got = measure_text(ink, SpottedText("2.85", 0.99, 250, 143, 8, 30))
    assert got is not None
    (x1, _), (x2, _) = got
    assert x2 - x1 == pytest.approx(300, abs=4)


def test_sigue_una_linea_curvada_por_el_papel() -> None:
    ink = _ink()
    pts = [(x, round(150 + 6 * math.sin((x - 100) / 300 * math.pi))) for x in range(100, 401)]
    for a, b in itertools.pairwise(pts):
        cv2.line(ink, a, b, 255, 1)
    _tick(ink, 100, 150)
    _tick(ink, 400, 150)
    got = measure_text(ink, SpottedText("2.85", 0.99, 250, 145, 8, 30))
    assert got is not None
    assert got[1][0] - got[0][0] == pytest.approx(300, abs=4)


def test_en_una_cadena_se_detiene_en_la_primera_marca() -> None:
    ink = _ink()
    cv2.line(ink, (50, 150), (550, 150), 255, 1)
    for x in (50, 200, 450, 550):
        cv2.line(ink, (x, 140), (x, 160), 255, 1)  # líneas de extensión
    got = measure_text(ink, SpottedText("2.50", 0.99, 325, 143, 8, 30))
    assert got is not None
    assert (got[0][0], got[1][0]) == pytest.approx((200, 450), abs=3)


def test_sin_linea_bajo_el_texto_no_hay_cota() -> None:
    ink = _ink()
    _text_blob(ink, 250, 143, 30, 8)
    assert measure_text(ink, SpottedText("2.85", 0.99, 250, 143, 8, 30)) is None


class _Spotter(TextSpotter):
    """Devuelve textos fijos para la hoja derecha y para la girada 90°."""

    name = "fijo"

    def __init__(self, upright: list[SpottedText], rotated: list[SpottedText]) -> None:
        self._answers = [upright, rotated]

    def spot(self, image: np.ndarray) -> list[SpottedText]:
        return self._answers.pop(0)


def test_cotas_verticales_vuelven_a_la_hoja_original() -> None:
    ink = _ink(500, 300)
    cv2.line(ink, (150, 100), (150, 400), 255, 1)  # cota vertical de 300 px
    _tick(ink, 150, 100)
    _tick(ink, 150, 400)
    rows = ink.shape[0]
    # en la hoja girada 90° a la derecha el punto (x, y) queda en (rows - 1 - y, x)
    rotated = [SpottedText("3.00", 0.99, rows - 1 - 250, 150 - 7, 8, 30)]
    spotter = _Spotter([SpottedText("COCINA", 0.99, 60, 60, 8, 40)], rotated)
    img = cv2.cvtColor(255 - ink, cv2.COLOR_GRAY2BGR)
    dims = read_text_dimensions(img, ink, spotter)
    assert len(dims) == 1
    d = dims[0]
    assert d.meters == (3.0,)
    assert d.length == pytest.approx(300, abs=4)
    xs = {round(d.p1[0]), round(d.p2[0])}
    assert all(abs(x - 150) <= 2 for x in xs)


def test_un_entero_sin_unidad_compite_como_cm_y_como_m() -> None:
    ink = _ink()
    cv2.line(ink, (100, 150), (400, 150), 255, 1)
    _tick(ink, 100, 150)
    _tick(ink, 400, 150)
    spotter = _Spotter([SpottedText("93", 0.9, 250, 143, 8, 16)], [])
    img = cv2.cvtColor(255 - ink, cv2.COLOR_GRAY2BGR)
    (d,) = read_text_dimensions(img, ink, spotter)
    assert d.meters == pytest.approx((0.93, 93.0))


def test_la_escala_sale_de_las_cotas_leidas_texto_primero() -> None:
    """Tres cotas coherentes (1 cm por px) y una mal leída: el consenso descarta la mala."""
    from plano3d.infrastructure.cv.raster_vector_detector import _text_first
    from plano3d.infrastructure.cv.vectorize import vectorize

    ink = _ink(400, 700)
    texts = []
    for y, (x1, x2), txt in (
        (80, (50, 350), "3.00"),
        (180, (50, 250), "2.00"),
        (280, (300, 450), "1.50"),
        (350, (100, 600), "9.99"),  # mal leída: 5 m dibujados
    ):
        cv2.line(ink, (x1, y), (x2, y), 255, 1)
        _tick(ink, x1, y)
        _tick(ink, x2, y)
        texts.append(SpottedText(txt, 0.99, (x1 + x2) / 2, y - 7, 8, 30))
    img = cv2.cvtColor(255 - ink, cv2.COLOR_GRAY2BGR)
    fit, readings = _text_first(vectorize(ink), img, ink, _Spotter([], []), texts)
    assert fit is not None
    # los ticks a 45° se toman en su primer cruce (~2 px antes del centro, en cada extremo)
    assert fit.meters_per_unit == pytest.approx(0.01, rel=0.03)
    assert sorted(r.text for r in readings) == ["1.50", "2.00", "3.00"]

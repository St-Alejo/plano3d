"""Láminas con varias plantas: preparación, separación, alineación y apilado en niveles."""

import asyncio

import cv2
import numpy as np

from plano3d.application.ports import DetectionRequest, ProgressPublisher
from plano3d.domain import Level, Point2D, Room, Wall
from plano3d.infrastructure.cv.classic_cv_detector import ClassicCVDetector
from plano3d.infrastructure.cv.imageio import encode_png
from plano3d.infrastructure.cv.multilevel import MultiLevelDetector, align_offset, level_names
from plano3d.infrastructure.cv.stages.layout import plan_blocks, prepare_sheet


class _Quiet(ProgressPublisher):
    async def publish(self, event: object) -> None:  # type: ignore[override]
        return None


def _plan(img: np.ndarray, x: int, y: int, shift: int = 0) -> None:
    white = (235, 235, 235)
    cv2.rectangle(img, (x, y), (x + 300, y + 400), white, 8)
    cv2.line(img, (x + 150 + shift, y), (x + 150 + shift, y + 250), white, 6)
    cv2.line(img, (x, y + 250), (x + 300, y + 250), white, 6)


def _sheet() -> np.ndarray:
    img = np.full((600, 900, 3), (40, 34, 30), np.uint8)  # fondo oscuro de CAD
    cv2.rectangle(img, (5, 5), (894, 594), (235, 235, 235), 1)  # marco de la lámina
    _plan(img, 60, 80)
    _plan(img, 480, 80, shift=40)
    for y in (80, 330, 480):  # ejes rojos que cruzan ambas plantas
        cv2.line(img, (10, y), (890, y), (40, 20, 230), 1)
    return img


def test_lamina_oscura_se_normaliza_y_separa_en_dos_plantas() -> None:
    sheet = prepare_sheet(_sheet())
    assert sheet[300, 450].tolist() == [255, 255, 255]  # sin ejes rojos ni fondo oscuro
    blocks = plan_blocks(sheet)
    assert len(blocks) == 2
    assert blocks[0][0] < blocks[1][0]  # orden de lectura
    assert align_offset(sheet, blocks[0], blocks[1]) == (0, 0)


def test_dos_plantas_quedan_apiladas_en_niveles() -> None:
    data = encode_png(_sheet())
    detector = MultiLevelDetector(ClassicCVDetector())
    result = asyncio.run(detector.detect(DetectionRequest("p", data, "image/png"), _Quiet()))
    levels = result.model.levels
    assert [lv.name for lv in levels] == ["Planta baja", "Planta alta"]
    assert [lv.elevation for lv in levels] == [0.0, 2.8]
    assert result.level_transforms is not None and len(result.level_transforms) == 2

    # el contorno exterior coincide en planta entre los dos niveles
    def bbox(lv: Level) -> tuple[float, float]:
        return min(w.start.x for w in lv.walls), min(w.start.y for w in lv.walls)

    (x0, y0), (x1, y1) = bbox(levels[0]), bbox(levels[1])
    assert abs(x0 - x1) < 0.3 and abs(y0 - y1) < 0.3


def test_nivel_trasladado() -> None:
    w = Wall("w", Point2D(0, 0), Point2D(4, 0))
    r = Room("r", "A", (Point2D(0, 0), Point2D(4, 0), Point2D(4, 3), Point2D(0, 3)))
    lv = Level("l", "N", walls=(w,), rooms=(r,)).translated(1.0, 2.0)
    assert (lv.walls[0].start.x, lv.walls[0].start.y) == (1.0, 2.0)
    assert lv.rooms[0].polygon[2] == Point2D(5.0, 5.0)


def test_nombres_de_niveles() -> None:
    def lv(interior: bool) -> Level:
        walls = [
            Wall("a", Point2D(0, 0), Point2D(10, 0)),
            Wall("b", Point2D(10, 0), Point2D(10, 8)),
            Wall("c", Point2D(10, 8), Point2D(0, 8)),
            Wall("d", Point2D(0, 8), Point2D(0, 0)),
        ]
        if interior:
            walls += [Wall(f"i{k}", Point2D(k, 0), Point2D(k, 8)) for k in range(2, 9, 2)]
        return Level("l", "N", walls=tuple(walls))

    assert level_names([lv(True), lv(True)]) == ["Planta baja", "Planta alta"]
    assert level_names([lv(True), lv(True), lv(False)]) == ["Planta baja", "Planta alta", "Azotea"]
    assert level_names([lv(True), lv(False)]) == ["Planta baja", "Azotea"]


def test_azotea_con_antepechos() -> None:
    from plano3d.infrastructure.cv.multilevel import with_parapets

    walls = (
        Wall("a", Point2D(0, 0), Point2D(10, 0)),
        Wall("b", Point2D(10, 0), Point2D(10, 8)),
        Wall("c", Point2D(10, 8), Point2D(0, 8)),
        Wall("d", Point2D(0, 8), Point2D(0, 0)),
        Wall("e", Point2D(4, 3), Point2D(6, 3)),  # volumen de la escalera
    )
    heights = [w.height for w in with_parapets(Level("l", "Azotea", walls=walls)).walls]
    assert heights == [1.1, 1.1, 1.1, 1.1, 2.6]

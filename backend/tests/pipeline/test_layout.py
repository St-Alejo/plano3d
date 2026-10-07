"""Análisis de lámina: la foto de fachada se descarta, el dibujo se conserva."""

import cv2
import numpy as np

from plano3d.infrastructure.cv.stages.layout import analyze_sheet, drawing_box


def _drawing(h: int, w: int) -> np.ndarray:
    img = np.full((h, w, 3), 245, np.uint8)
    cv2.rectangle(img, (40, 40), (w - 40, h - 40), (20, 20, 20), 8)
    cv2.line(img, (w // 2, 40), (w // 2, h - 40), (20, 20, 20), 6)
    cv2.line(img, (40, h // 2), (w // 2, h // 2), (20, 20, 20), 6)
    return img


def _photo(h: int, w: int) -> np.ndarray:
    rng = np.random.default_rng(3)
    sky = np.linspace(120, 250, h, dtype=np.float32)[:, None, None] * np.ones((1, w, 3))
    noise = rng.normal(0, 35, (h, w, 3))
    return np.clip(sky + noise, 0, 255).astype(np.uint8)


def test_lamina_con_foto_se_recorta_al_dibujo() -> None:
    sheet = np.full((700, 500, 3), 255, np.uint8)
    sheet[:240] = _photo(240, 500)
    sheet[260:] = _drawing(440, 500)
    kinds = sorted(b.kind for b in analyze_sheet(sheet))
    assert kinds == ["drawing", "photo"]
    box = drawing_box(sheet)
    assert box is not None
    x0, y0, x1, y1 = box
    # el corte cae en la franja vacía entre la foto y el muro superior del dibujo (y=300)
    assert 240 <= y0 < 296 and y1 == 700 and (x0, x1) == (0, 500)


def test_plano_solo_no_se_toca() -> None:
    assert drawing_box(_drawing(500, 400)) is None

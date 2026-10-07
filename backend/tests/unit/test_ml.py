"""Segmentación aprendida: datos sintéticos y uso de la probabilidad en el pipeline."""

import numpy as np
from ml.synth import STYLES, random_plan, render

from plano3d.infrastructure.ml.seg_model import WallSegmenter, filter_components


def test_sintetico_marca_muros_y_no_muebles() -> None:
    for k, style in enumerate(STYLES):
        rng = np.random.default_rng(k)
        gray, mask = render(random_plan(rng), style, rng)
        assert gray.shape == mask.shape
        assert 0.01 < (mask > 0).mean() < 0.4
        # bajo la máscara el plano es claramente más oscuro que fuera (los muros huecos solo
        # tienen tinta en el borde y los estilos de baja resolución la dejan gris)
        assert gray[mask > 0].mean() < gray[mask == 0].mean() - 15


def test_filtro_conserva_solo_lo_que_la_red_ve_como_muro() -> None:
    mask = np.zeros((100, 100), np.uint8)
    mask[10:15, 10:90] = 255  # muro
    mask[50:70, 40:60] = 255  # auto
    prob = np.zeros((100, 100), np.float32)
    prob[10:15, 10:90] = 0.9
    out = filter_components(mask, prob)
    assert out[12, 50] == 255 and out[60, 50] == 0


def test_sin_modelo_no_hay_segmentador(tmp_path) -> None:  # type: ignore[no-untyped-def]
    assert not WallSegmenter(tmp_path / "no-existe.onnx").available


def test_exportar_correcciones_rasteriza_muros_sin_vanos() -> None:
    from scripts.export_dataset import wall_mask

    from plano3d.domain import Level, Opening, OpeningKind, Point2D, Wall

    door = Opening("o", OpeningKind.DOOR, offset=1.0, width=1.0, height=2.1)
    wall = Wall("w", Point2D(0.5, 1.0), Point2D(4.5, 1.0), thickness=0.2, openings=(door,))
    mask = wall_mask(Level("l", "N", walls=(wall,)), 0.01, (300, 600))
    assert mask[100, 100] == 255  # muro
    assert mask[100, 200] == 0  # el vano de la puerta
    assert mask[200, 100] == 0

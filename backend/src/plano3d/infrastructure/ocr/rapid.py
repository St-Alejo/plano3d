"""RapidOCR (ONNX en CPU, Apache-2.0): reconocimiento sobre recortes y lectura de la hoja."""

from __future__ import annotations

import threading
from collections.abc import Sequence
from typing import Any

from plano3d.application.ports import Image, ReadText, SpottedText, TextReader, TextSpotter

BATCH = 8
MAX_RATIO = 20.0


class RapidOcrReader(TextReader):
    name = "rapidocr"

    def __init__(self) -> None:
        self._engine: Any = None
        self._lock = threading.Lock()

    def _ocr(self) -> Any:
        # carga perezosa: el modelo pesa ~15 MB y tarda ~2 s en abrir
        with self._lock:
            if self._engine is None:
                from rapidocr_onnxruntime import RapidOCR

                self._engine = RapidOCR()
            return self._engine

    def read(self, crops: Sequence[Image]) -> list[ReadText]:
        out = [ReadText("", 0.0) for _ in crops]
        if not crops:
            return out
        engine = self._ocr()
        # el reconocedor rellena cada lote hasta el recorte más ancho: se agrupan por
        # proporción y se descartan los desmesurados (no son el texto de una cota)
        ratios = [c.shape[1] / max(1, c.shape[0]) for c in crops]
        order = sorted((i for i, r in enumerate(ratios) if r <= MAX_RATIO), key=lambda i: ratios[i])
        for k in range(0, len(order), BATCH):
            idx = order[k : k + BATCH]
            try:
                res, _ = engine.text_rec([crops[i] for i in idx])
            except Exception:
                continue
            for i, (text, conf) in zip(idx, res, strict=False):
                out[i] = ReadText(str(text).strip(), float(conf))
        return out


#: el detector de texto pierde letras pequeñas en hojas grandes y es lento: se lee a este lado
SPOT_MAX_SIDE = 1600
MIN_SPOT_CONFIDENCE = 0.5


class RapidOcrSpotter(TextSpotter):
    """Detección + reconocimiento sobre la imagen entera (comparte el modelo del lector)."""

    name = "rapidocr"

    def __init__(self, reader: RapidOcrReader | None = None) -> None:
        self._reader = reader or RapidOcrReader()

    def spot(self, image: Image) -> list[SpottedText]:
        import cv2

        h, w = image.shape[:2]
        f = min(1.0, SPOT_MAX_SIDE / max(h, w))
        img = cv2.resize(image, None, fx=f, fy=f, interpolation=cv2.INTER_AREA) if f < 1 else image
        if img.ndim == 2:
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        try:
            res, _ = self._reader._ocr()(img)
        except Exception:
            return []
        out: list[SpottedText] = []
        for box, text, conf in res or []:
            if float(conf) < MIN_SPOT_CONFIDENCE or not str(text).strip():
                continue
            xs = [p[0] / f for p in box]
            ys = [p[1] / f for p in box]
            out.append(
                SpottedText(
                    str(text).strip(),
                    float(conf),
                    sum(xs) / len(xs),
                    sum(ys) / len(ys),
                    max(ys) - min(ys),
                )
            )
        return out


def available() -> bool:
    try:
        import rapidocr_onnxruntime  # noqa: F401
    except ImportError:
        return False
    return True

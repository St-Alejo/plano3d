"""RapidOCR (ONNX en CPU, Apache-2.0) en modo SOLO reconocimiento sobre recortes."""

from __future__ import annotations

import threading
from collections.abc import Sequence
from typing import Any

from plano3d.application.ports import Image, ReadText, TextReader

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


def available() -> bool:
    try:
        import rapidocr_onnxruntime  # noqa: F401
    except ImportError:
        return False
    return True

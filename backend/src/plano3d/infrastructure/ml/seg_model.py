"""Segmentación aprendida de muros (ONNX, CPU) para depurar la máscara de la CV clásica.

La red se entrena con planos sintéticos (``backend/ml``) y se publica como
``backend/models/plan-seg-vN.onnx``. Aquí solo se usa onnxruntime: el servidor no
necesita PyTorch. Si no hay modelo o no hay onnxruntime, todo sigue sin ella.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import numpy.typing as npt

log = logging.getLogger(__name__)

Img = npt.NDArray[np.uint8]
MODELS = Path(__file__).resolve().parents[4] / "models"
#: lado máximo con que se pasa la imagen por la red (más grande se reduce)
MAX_SIDE = 1600


class WallSegmenter:
    """Probabilidad de muro por píxel; carga perezosa del modelo más reciente."""

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or _latest()
        self._session: Any = None
        self._lock = threading.Lock()

    @property
    def available(self) -> bool:
        return self._path is not None and self._path.exists()

    def _sess(self) -> Any:
        with self._lock:
            if self._session is None:
                import onnxruntime as ort  # type: ignore[import-untyped]

                self._session = ort.InferenceSession(
                    str(self._path), providers=["CPUExecutionProvider"]
                )
            return self._session

    def probability(self, gray: Img) -> npt.NDArray[np.float32]:
        """Mapa 0..1 del mismo tamaño que ``gray`` (papel claro, tinta oscura)."""
        h, w = gray.shape[:2]
        f = min(1.0, MAX_SIDE / max(h, w))
        small = cv2.resize(gray, None, fx=f, fy=f, interpolation=cv2.INTER_AREA) if f < 1 else gray
        sh, sw = small.shape[:2]
        ph, pw = (-sh) % 16, (-sw) % 16
        padded = np.pad(small, ((0, ph), (0, pw)), constant_values=255)
        x = (1.0 - padded.astype(np.float32) / 255.0)[None, None]
        (logit,) = self._sess().run(None, {"ink": x})
        prob = 1.0 / (1.0 + np.exp(-logit[0, 0, :sh, :sw]))
        if f < 1:
            prob = cv2.resize(prob, (w, h), interpolation=cv2.INTER_LINEAR)
        return np.asarray(prob, np.float32)


def _latest() -> Path | None:
    found = sorted(MODELS.glob("plan-seg-v*.onnx"))
    return found[-1] if found else None


def filter_components(mask: Img, prob: npt.NDArray[np.float32], keep_at: float = 0.35) -> Img:
    """Conserva las manchas de la máscara clásica que la red reconoce como muro.

    No dibuja muros nuevos: la geometría sigue siendo la de la CV clásica (exacta en
    bordes); la red solo decide qué manchas son muros y cuáles muebles, autos o cotas.
    """
    n, labels = cv2.connectedComponents(mask, connectivity=8)
    if n <= 1:
        return mask
    flat = np.asarray(labels, np.int64).ravel()
    sums = np.bincount(flat, weights=prob.ravel(), minlength=n)
    counts = np.bincount(flat, minlength=n)
    mean = sums / np.maximum(counts, 1)
    keep = (mean >= keep_at).astype(np.uint8) * 255
    keep[0] = 0
    return np.asarray(keep[labels], np.uint8)

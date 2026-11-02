"""Groq visión como lector de cotas: misma forma de respuesta que Claude.

El modelo de visión de Groq acepta pocas imágenes por mensaje y su capa gratuita limita
los tokens por minuto (cada imagen, por pequeña que sea, cuesta ~1000). Por eso los
recortes no van sueltos: se montan en UNA hoja, una fila numerada por recorte (``#0``,
``#1``…), y el modelo transcribe fila por fila. 16 cotas cuestan lo que una sola imagen.

Si la API falla, devuelve lecturas vacías y el pipeline sigue con el OCR local.
"""

from __future__ import annotations

import base64
import logging
from collections.abc import Sequence
from typing import Any

import cv2
import numpy as np

from plano3d.application.ports import Image, ReadText, TextReader
from plano3d.infrastructure.groq.client import GroqClient, GroqError
from plano3d.infrastructure.ocr.budget import ResponseCache

log = logging.getLogger(__name__)

#: modelo de Groq que acepta imágenes
MODEL = "qwen/qwen3.8-27b"
#: recortes por hoja (una llamada)
BATCH = 16
#: alto de cada fila y ancho máximo del recorte en la hoja (px)
ROW_H, CROP_H, CROP_W, LABEL_W = 60, 44, 320, 64

_PROMPT = (
    "La imagen tiene filas numeradas en rojo (#0, #1, ...). Cada fila es un recorte de un "
    "plano arquitectónico colombiano con el TEXTO DE UNA COTA (una medida). Transcribe "
    "exactamente lo escrito en cada fila, sin convertir unidades: coma decimal '3,45', "
    "centímetros '345', superíndice de centímetros como '3^45' (el número pequeño elevado a "
    "la derecha). Si una fila no tiene un número legible, texto vacío y confianza 0. "
    'Responde solo JSON: {"readings": [{"index": <número de la fila>, "text": <texto>, '
    '"confidence": <0 a 1>}]}, una por fila.'
)


def contact_sheet(crops: Sequence[Image]) -> Image:
    """Una fila por recorte: la etiqueta ``#i`` en rojo y el recorte a alto fijo."""
    sheet = np.full((ROW_H * len(crops), LABEL_W + CROP_W + 8, 3), 255, np.uint8)
    for i, crop in enumerate(crops):
        c = crop if crop.ndim == 3 else cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR)
        h, w = c.shape[:2]
        scale = min(CROP_H / max(h, 1), CROP_W / max(w, 1))
        c = cv2.resize(c, (max(1, round(w * scale)), max(1, round(h * scale))))
        y = i * ROW_H
        cv2.putText(sheet, f"#{i}", (4, y + 38), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 200), 2)
        top = y + (ROW_H - c.shape[0]) // 2
        sheet[top : top + c.shape[0], LABEL_W : LABEL_W + c.shape[1]] = c
        cv2.line(sheet, (0, y + ROW_H - 1), (sheet.shape[1], y + ROW_H - 1), (190, 190, 190), 1)
    return sheet


def _png_b64(img: Image) -> str:
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise ValueError("No se pudo codificar la hoja de recortes")
    return base64.standard_b64encode(buf.tobytes()).decode("ascii")


class GroqTextReader(TextReader):
    name = "groq"

    def __init__(
        self,
        client: GroqClient | None = None,
        model: str = MODEL,
        cache: ResponseCache | None = None,
    ) -> None:
        self._client = client or GroqClient()
        self._model = model
        self._cache = cache or ResponseCache()

    def read(self, crops: Sequence[Image]) -> list[ReadText]:
        out = [ReadText("", 0.0) for _ in crops]
        for start in range(0, len(crops), BATCH):
            chunk = list(crops[start : start + BATCH])
            for idx, res in self._read_batch(chunk).items():
                if 0 <= idx < len(chunk):
                    out[start + idx] = res
        return out

    def _read_batch(self, crops: list[Image]) -> dict[int, ReadText]:
        png = _png_b64(contact_sheet(crops))
        key = ResponseCache.key("groq", self._model, _PROMPT, png)
        cached: dict[str, Any] | None = self._cache.get(key)
        if cached is None:
            content = [
                {"type": "text", "text": _PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{png}"}},
            ]
            try:
                cached = self._client.chat_json(
                    self._model, [{"role": "user", "content": content}], max_tokens=1200
                )
            except GroqError as exc:
                log.warning("Groq no leyó las cotas: %s", exc)
                return {}
            self._cache.put(key, cached)
        out: dict[int, ReadText] = {}
        for item in cached.get("readings", []):
            try:
                conf = max(0.0, min(1.0, float(item["confidence"])))
                out[int(item["index"])] = ReadText(str(item["text"]).strip(), conf)
            except (KeyError, TypeError, ValueError):
                continue
        return out

"""Claude visión como lector de cotas (ADR-014, fase 7).

Se le envían RECORTES pequeños y numerados (nunca la hoja entera: la API reduce las
imágenes grandes y los números de cota se volverían ilegibles), en lotes, y responde
con salida estructurada (JSON Schema): un texto por recorte, tal como está escrito.
Lee bien lo que el OCR genérico no: superíndices ``3⁵⁰``, cotas a mano, rotadas.

Modelo: Claude Haiku 4.5, el más económico (leer números es una tarea simple). Cada
llamada pasa por un tope de gasto y una caché en disco (``budget.py``): con el tope
agotado Claude se apaga solo. Si no hay credenciales o la API falla, devuelve lecturas
vacías: el pipeline sigue con el OCR local (nunca se cae un análisis por esto).
"""

from __future__ import annotations

import base64
import json
import logging
from collections.abc import Sequence
from typing import Any

import cv2

from plano3d.application.ports import Image, ReadText, TextReader
from plano3d.infrastructure.ocr.budget import PRICES, ClaudeBudget, ResponseCache

log = logging.getLogger(__name__)

MODEL = "claude-haiku-4-5"
#: tokens que cuesta una imagen pequeña de cota (para estimar antes de llamar)
TOKENS_PER_CROP = 120
BATCH = 24

_PROMPT = (
    "Cada imagen numerada es un recorte de un plano arquitectónico colombiano con el "
    "TEXTO DE UNA COTA (una medida). Transcribe exactamente lo escrito en cada recorte, "
    "sin convertir unidades: coma decimal '3,45', centímetros '345', superíndice de "
    "centímetros como '3^45' (el número pequeño elevado a la derecha). Si un recorte no "
    "contiene un número legible, devuelve texto vacío y confianza 0."
)

_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "readings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "text": {"type": "string"},
                    "confidence": {"type": "number"},
                },
                "required": ["index", "text", "confidence"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["readings"],
    "additionalProperties": False,
}


def _png_b64(img: Image) -> str:
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise ValueError("No se pudo codificar el recorte")
    return base64.standard_b64encode(buf.tobytes()).decode("ascii")


class ClaudeTextReader(TextReader):
    name = "claude"

    def __init__(
        self,
        client: Any | None = None,
        model: str = MODEL,
        budget: ClaudeBudget | None = None,
        cache: ResponseCache | None = None,
    ) -> None:
        self._client = client
        self._model = model
        self._budget = budget or ClaudeBudget()
        self._cache = cache or ResponseCache()

    def _api(self) -> Any:
        if self._client is None:
            import anthropic

            # credenciales del entorno: ANTHROPIC_API_KEY, token o perfil de `ant auth login`
            self._client = anthropic.Anthropic(max_retries=2, timeout=60.0)
        return self._client

    def read(self, crops: Sequence[Image]) -> list[ReadText]:
        out = [ReadText("", 0.0) for _ in crops]
        for start in range(0, len(crops), BATCH):
            chunk = list(crops[start : start + BATCH])
            for idx, res in self._read_batch(chunk).items():
                if 0 <= idx < len(chunk):
                    out[start + idx] = res
        return out

    def _read_batch(self, crops: list[Image]) -> dict[int, ReadText]:
        pngs = [_png_b64(c) for c in crops]
        key = ResponseCache.key(self._model, _PROMPT, *pngs)
        cached = self._cache.get(key)
        if cached is None:
            pin, pout = PRICES.get(self._model, PRICES["claude-opus-5-5"])
            estimate = (len(crops) * TOKENS_PER_CROP * pin + len(crops) * 30 * pout) / 1e6
            if not self._budget.allows(estimate):
                log.warning("Tope de gasto de Claude alcanzado: se sigue con el OCR local")
                return {}
            cached = self._call(pngs)
            if cached is None:
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

    def _call(self, pngs: list[str]) -> dict[str, Any] | None:
        content: list[dict[str, Any]] = []
        for i, data in enumerate(pngs):
            content.append({"type": "text", "text": f"Recorte {i}:"})
            content.append(
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/png", "data": data},
                }
            )
        content.append({"type": "text", "text": _PROMPT})
        try:
            import anthropic

            response = self._api().messages.create(
                model=self._model,
                max_tokens=2000,
                output_config={"format": {"type": "json_schema", "schema": _SCHEMA}},
                messages=[{"role": "user", "content": content}],
            )
        except ImportError:
            log.warning("El SDK de Anthropic no está instalado: sin lectura con Claude")
            return None
        except anthropic.APIStatusError as exc:
            log.warning("Claude no leyó las cotas (HTTP %s): %s", exc.status_code, exc.message)
            return None
        except anthropic.APIConnectionError as exc:
            log.warning("Claude no disponible: %s", exc)
            return None
        usage = getattr(response, "usage", None)
        if usage is not None:
            self._budget.record(self._model, int(usage.input_tokens), int(usage.output_tokens))
        if response.stop_reason == "refusal":
            log.warning("Claude declinó leer el lote de cotas")
            return None
        text = next((b.text for b in response.content if b.type == "text"), "")
        try:
            parsed: dict[str, Any] = json.loads(text)
        except json.JSONDecodeError:
            log.warning("Respuesta de Claude no es JSON válido")
            return None
        return parsed


def claude_available() -> bool:
    """¿Hay SDK y alguna credencial configurada? (no hace llamadas a la API)."""
    import os

    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    if os.environ.get("PLANO3D_CLAUDE", "").lower() in ("0", "false", "no"):
        return False
    if not ClaudeBudget().allows():
        return False  # tope de gasto agotado
    return bool(
        os.environ.get("ANTHROPIC_API_KEY")
        or os.environ.get("ANTHROPIC_AUTH_TOKEN")
        or os.environ.get("ANTHROPIC_PROFILE")
    )

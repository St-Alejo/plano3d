"""Fotos realistas con la API de imágenes de OpenAI (``/v1/images/edits``).

- Modelo ``gpt-image-2`` en calidad ``low`` a 1536x1024: en las pruebas conserva el
  encuadre y la geometría de la captura mejor que ``gpt-image-1-mini`` en ``medium``, y
  cuesta ~0,013 USD por foto. Se cambian con ``PLANO3D_IMAGE_MODEL`` y
  ``PLANO3D_IMAGE_QUALITY``.
- Tope de gasto en disco (``PLANO3D_OPENAI_BUDGET_USD``, 1,80 USD por defecto): el costo
  de cada foto se calcula con los tokens que devuelve la API a precio de lista (con margen).
- Caché por hash de (modelo, calidad, instrucción, captura): repetir la misma vista no
  vuelve a pagar.
- La clave sale de ``OPENAI_API_KEY`` (``backend/.env``, ignorado por git); nunca se registra.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

import httpx

from plano3d.application.ports import PhotoGenerator
from plano3d.application.use_cases.errors import PhotosUnavailableError
from plano3d.infrastructure.ocr.budget import ResponseCache

log = logging.getLogger(__name__)

URL = "https://api.openai.com/v1/images/edits"
DATA = Path(__file__).resolve().parents[4] / "data"
DEFAULT_MODEL = "gpt-image-2"
DEFAULT_QUALITY = "low"
DEFAULT_BUDGET_USD = 1.8
SIZE = "1536x1024"
#: USD por millón de tokens: (texto de entrada, imagen de entrada, imagen de salida).
#: gpt-image-2 se cobra aquí como gpt-image-1, que es más caro: el tope queda con margen.
PRICES: dict[str, tuple[float, float, float]] = {
    "gpt-image-1": (5.0, 10.0, 40.0),
    "gpt-image-2": (5.0, 10.0, 40.0),
    "gpt-image-1.5": (5.0, 8.0, 32.0),
    "gpt-image-1-mini": (2.0, 2.5, 8.0),
}
#: estimación por foto antes de pedirla (captura de ~950 tokens y salida en calidad baja)
ESTIMATE_USD = 0.02


def openai_available() -> bool:
    """¿Hay clave de OpenAI y no está apagado? (no hace llamadas a la API)."""
    if os.environ.get("PLANO3D_OPENAI", "").lower() in ("0", "false", "no"):
        return False
    return bool(os.environ.get("OPENAI_API_KEY"))


def photo_cost(model: str, usage: dict[str, Any] | None) -> float:
    """Costo de una foto según los tokens que reporta la API (sin ``usage``: la estimación)."""
    if not usage:
        return ESTIMATE_USD
    ptext, pimg, pout = PRICES.get(model, PRICES["gpt-image-1"])
    details = usage.get("input_tokens_details") or {}
    img_in = int(details.get("image_tokens", 0))
    text_in = int(details.get("text_tokens", max(0, int(usage.get("input_tokens", 0)) - img_in)))
    out = int(usage.get("output_tokens", 0))
    return (text_in * ptext + img_in * pimg + out * pout) / 1_000_000


class ImageBudget:
    """Gasto acumulado en un archivo, para que el tope sobreviva a los reinicios."""

    def __init__(self, path: Path | None = None, limit_usd: float | None = None) -> None:
        self._path = path or DATA / "openai_usage.json"
        env = os.environ.get("PLANO3D_OPENAI_BUDGET_USD")
        self.limit = limit_usd if limit_usd is not None else float(env or DEFAULT_BUDGET_USD)
        self._lock = threading.Lock()

    def _load(self) -> dict[str, Any]:
        try:
            data: dict[str, Any] = json.loads(self._path.read_text(encoding="utf-8"))
            return data
        except (OSError, ValueError):
            return {"spent_usd": 0.0, "photos": 0}

    @property
    def spent(self) -> float:
        return float(self._load()["spent_usd"])

    def remaining(self) -> float:
        return max(0.0, self.limit - self.spent)

    def record(self, model: str, usage: dict[str, Any] | None) -> float:
        cost = photo_cost(model, usage)
        with self._lock:
            data = self._load()
            data["spent_usd"] = round(float(data["spent_usd"]) + cost, 6)
            data["photos"] = int(data["photos"]) + 1
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        log.info("Foto IA: %.4f USD; van %.4f de %.2f USD", cost, data["spent_usd"], self.limit)
        return cost


class OpenAIPhotoGenerator(PhotoGenerator):
    cost_per_photo = ESTIMATE_USD

    def __init__(
        self,
        http: httpx.AsyncClient | None = None,
        api_key: str | None = None,
        budget: ImageBudget | None = None,
        cache: ResponseCache | None = None,
        model: str | None = None,
        quality: str | None = None,
        retry_wait_s: float = 12.0,
    ) -> None:
        self._http = http
        self._key = api_key
        self._budget = budget or ImageBudget()
        self._cache = cache or ResponseCache(DATA / "openai_cache")
        self.model = model or os.environ.get("PLANO3D_IMAGE_MODEL") or DEFAULT_MODEL
        self.quality = quality or os.environ.get("PLANO3D_IMAGE_QUALITY") or DEFAULT_QUALITY
        self._retry_wait = retry_wait_s

    def remaining_usd(self) -> float:
        return self._budget.remaining()

    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=180.0)
        return self._http

    async def aclose(self) -> None:
        if self._http is not None:
            await self._http.aclose()

    async def generate(self, image: bytes, prompt: str) -> bytes:
        key = self._cache.key(self.model, self.quality, SIZE, prompt, image)
        cached = self._cache.get(key)
        if cached is not None:
            return base64.b64decode(cached["b64"])
        if self._budget.remaining() < self.cost_per_photo:
            raise PhotosUnavailableError("Se acabó el presupuesto para fotos con IA")
        api_key = self._key or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise PhotosUnavailableError("Falta la clave de OpenAI en el servidor")
        mime = "image/png" if image.startswith(b"\x89PNG") else "image/jpeg"
        data = {
            "model": self.model,
            "prompt": prompt,
            "quality": self.quality,
            "size": SIZE,
            "output_format": "jpeg",
            "output_compression": "85",
            "n": "1",
        }
        for attempt in range(3):
            try:
                r = await self._client().post(
                    URL,
                    headers={"Authorization": f"Bearer {api_key}"},
                    files={"image[]": ("captura", image, mime)},
                    data=data,
                )
            except httpx.HTTPError as exc:
                raise PhotosUnavailableError("No se pudo conectar con OpenAI") from exc
            # límite de imágenes por minuto: se espera un poco y se reintenta
            if r.status_code == 429 and _code(r) != "insufficient_quota" and attempt < 2:
                await asyncio.sleep(self._retry_wait * (attempt + 1))
                continue
            break
        if r.status_code != 200:
            raise PhotosUnavailableError(_message(r))
        body = r.json()
        b64 = body["data"][0]["b64_json"]
        self._budget.record(self.model, body.get("usage"))
        self._cache.put(key, {"b64": b64})
        return base64.b64decode(b64)


def _error(r: httpx.Response) -> dict[str, Any]:
    try:
        err = r.json().get("error") or {}
    except ValueError:
        return {}
    return err if isinstance(err, dict) else {}


def _code(r: httpx.Response) -> str:
    return str(_error(r).get("code") or "")


def _message(r: httpx.Response) -> str:
    """Error de OpenAI en palabras del usuario (sin repetir el detalle técnico)."""
    err = _error(r)
    code = str(err.get("code") or "")
    log.warning("OpenAI imágenes %s %s: %s", r.status_code, code, str(err.get("message", ""))[:200])
    if r.status_code == 401:
        return "La clave de OpenAI no es válida o ya venció"
    if code == "insufficient_quota":
        return "La cuenta de OpenAI se quedó sin créditos"
    if code == "moderation_blocked":
        return "OpenAI rechazó esta imagen; prueba con otra vista"
    if r.status_code == 429:
        return "OpenAI está ocupado; intenta en un minuto"
    return "OpenAI no pudo generar la foto; intenta de nuevo"

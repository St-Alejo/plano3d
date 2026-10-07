"""Tope de gasto y caché en disco para las llamadas a Claude.

- El gasto real (tokens de entrada y salida de cada respuesta, a precio de lista) se
  acumula en un archivo; al llegar al tope (``PLANO3D_CLAUDE_BUDGET_USD``) Claude se
  apaga solo y el sistema sigue con el OCR local.
- La caché guarda cada respuesta por el hash de lo que se envió: volver a analizar el
  mismo plano (evaluaciones, reintentos) no vuelve a pagar.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

DATA = Path(__file__).resolve().parents[4] / "data"
DEFAULT_BUDGET_USD = 1.0
#: USD por millón de tokens (entrada, salida), precio de lista
PRICES: dict[str, tuple[float, float]] = {
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-sonnet-5-5": (3.0, 15.0),
    "claude-opus-5-5": (5.0, 25.0),
}


class ClaudeBudget:
    def __init__(self, path: Path | None = None, limit_usd: float | None = None) -> None:
        self._path = path or DATA / "claude_usage.json"
        env = os.environ.get("PLANO3D_CLAUDE_BUDGET_USD")
        self.limit = limit_usd if limit_usd is not None else float(env or DEFAULT_BUDGET_USD)
        self._lock = threading.Lock()

    def _load(self) -> dict[str, Any]:
        try:
            data: dict[str, Any] = json.loads(self._path.read_text(encoding="utf-8"))
            return data
        except (OSError, ValueError):
            return {"spent_usd": 0.0, "calls": 0, "input_tokens": 0, "output_tokens": 0}

    @property
    def spent(self) -> float:
        return float(self._load()["spent_usd"])

    def allows(self, estimate_usd: float = 0.0) -> bool:
        return self.spent + estimate_usd <= self.limit

    def record(self, model: str, input_tokens: int, output_tokens: int) -> float:
        pin, pout = PRICES.get(model, PRICES["claude-opus-5-5"])
        cost = (input_tokens * pin + output_tokens * pout) / 1_000_000
        with self._lock:
            data = self._load()
            data["spent_usd"] = round(float(data["spent_usd"]) + cost, 6)
            data["calls"] = int(data["calls"]) + 1
            data["input_tokens"] = int(data["input_tokens"]) + input_tokens
            data["output_tokens"] = int(data["output_tokens"]) + output_tokens
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        log.info(
            "Claude: %.4f USD esta llamada, %.4f de %.2f USD", cost, data["spent_usd"], self.limit
        )
        return cost


class ResponseCache:
    def __init__(self, folder: Path | None = None) -> None:
        self._dir = folder or DATA / "claude_cache"

    @staticmethod
    def key(*parts: bytes | str) -> str:
        h = hashlib.sha256()
        for p in parts:
            h.update(p.encode() if isinstance(p, str) else p)
            h.update(b"\0")
        return h.hexdigest()

    def get(self, key: str) -> Any | None:
        try:
            return json.loads((self._dir / f"{key}.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def put(self, key: str, value: Any) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        (self._dir / f"{key}.json").write_text(
            json.dumps(value, ensure_ascii=False), encoding="utf-8"
        )

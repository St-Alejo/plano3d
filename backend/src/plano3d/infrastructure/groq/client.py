"""Cliente mínimo de Groq (``/openai/v1/chat/completions``) con respuesta JSON.

Usa ``httpx`` (ya es dependencia) en vez de otro SDK. La clave sale de ``GROQ_API_KEY``
(``backend/.env``, ignorado por git); nunca se registra.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from collections.abc import Callable
from typing import Any

import httpx

log = logging.getLogger(__name__)

URL = "https://api.groq.com/openai/v1/chat/completions"
#: espera máxima ante un 429 antes de rendirse (el pipeline sigue con el OCR local)
MAX_WAIT_S = 30.0
_RETRY = re.compile(r"try again in (?:(\d+)m)?([\d.]+)s")


def _retry_after(message: str) -> float | None:
    """Segundos que Groq pide esperar ("Please try again in 1m2.5s"), o None."""
    m = _RETRY.search(message)
    return int(m.group(1) or 0) * 60 + float(m.group(2)) if m else None


class GroqError(RuntimeError):
    """Groq no respondió o la respuesta no era JSON válido."""


def groq_available() -> bool:
    """¿Hay clave de Groq y no está apagado? (no hace llamadas a la API)."""
    if os.environ.get("PLANO3D_GROQ", "").lower() in ("0", "false", "no"):
        return False
    return bool(os.environ.get("GROQ_API_KEY"))


class GroqClient:
    def __init__(
        self,
        http: Any | None = None,
        api_key: str | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._http = http
        self._key = api_key
        self._sleep = sleep

    def _client(self) -> Any:
        if self._http is None:
            self._http = httpx.Client(timeout=60.0)
        return self._http

    def chat_json(
        self,
        model: str,
        messages: list[dict[str, Any]],
        schema: dict[str, Any] | None = None,
        max_tokens: int = 1500,
    ) -> dict[str, Any]:
        """Una respuesta JSON. Con ``schema``, salida estructurada estricta."""
        fmt: dict[str, Any] = (
            {
                "type": "json_schema",
                "json_schema": {"name": "out", "strict": True, "schema": schema},
            }
            if schema
            else {"type": "json_object"}
        )
        body = {
            "model": model,
            "messages": messages,
            "max_completion_tokens": max_tokens,
            "temperature": 0,
            "response_format": fmt,
        }
        key = self._key or os.environ.get("GROQ_API_KEY", "")
        for attempt in range(2):
            try:
                r = self._client().post(URL, json=body, headers={"Authorization": f"Bearer {key}"})
            except httpx.HTTPError as exc:
                raise GroqError(f"Groq no disponible: {exc}") from exc
            if r.status_code == 200:
                break
            try:
                detail = str(r.json().get("error", {}).get("message", ""))
            except ValueError:
                detail = ""
            wait = _retry_after(detail)
            # capa gratuita: tope de tokens por minuto. Se espera lo que pide Groq, una vez
            if r.status_code == 429 and attempt == 0 and wait is not None and wait <= MAX_WAIT_S:
                log.info("Groq pide esperar %.0f s (límite por minuto)", wait)
                self._sleep(wait + 0.5)
                continue
            raise GroqError(f"Groq respondió HTTP {r.status_code}: {detail}")
        try:
            text = r.json()["choices"][0]["message"]["content"] or ""
            parsed: dict[str, Any] = json.loads(text)
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise GroqError("La respuesta de Groq no fue JSON válido") from exc
        return parsed

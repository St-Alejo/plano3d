"""Groq como intérprete de los chats: mismas instrucciones, esquema y conversión que Claude.

Así el editor y la vista 3D reciben exactamente las mismas operaciones sea cual sea el
proveedor; solo cambia la llamada. Las respuestas se cachean (mismo mensaje y plano →
misma respuesta, sin gastar cuota).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from plano3d.application.ports import AssistantReply, PlanAssistant
from plano3d.application.use_cases.errors import AssistantUnavailableError
from plano3d.infrastructure.assistant.claude_assistant import (
    _SYSTEM,
    _VIEWER_SYSTEM,
    SCHEMA,
    VIEWER_SCHEMA,
    to_plan_op,
    to_viewer_action,
)
from plano3d.infrastructure.groq.client import GroqClient, GroqError
from plano3d.infrastructure.ocr.budget import ResponseCache

log = logging.getLogger(__name__)

#: el modelo de texto de Groq con salida estructurada estricta
MODEL = "openai/gpt-oss-120b"


class GroqPlanAssistant(PlanAssistant):
    def __init__(
        self,
        client: GroqClient | None = None,
        model: str = MODEL,
        cache: ResponseCache | None = None,
    ) -> None:
        self._client = client or GroqClient()
        self._model = model
        self._cache = cache or ResponseCache()

    async def interpret(self, message: str, context: str, scope: str = "plan") -> AssistantReply:
        return await asyncio.to_thread(self._interpret, message, context, scope)

    def _interpret(self, message: str, context: str, scope: str = "plan") -> AssistantReply:
        viewer = scope == "viewer"
        system, schema = (_VIEWER_SYSTEM, VIEWER_SCHEMA) if viewer else (_SYSTEM, SCHEMA)
        label = "Estado de la vista" if viewer else "Plano actual"
        user = f"{label}:\n{context or '(vacío)'}\n\nMensaje: {message}"
        key = ResponseCache.key("groq", self._model, system, user)
        data: dict[str, Any] | None = self._cache.get(key)
        if data is None:
            try:
                data = self._client.chat_json(
                    self._model,
                    [{"role": "system", "content": system}, {"role": "user", "content": user}],
                    schema,
                )
            except GroqError as exc:
                log.warning("El asistente de Groq no respondió: %s", exc)
                raise AssistantUnavailableError(
                    "El asistente con IA no respondió; intenta de nuevo"
                ) from exc
            self._cache.put(key, data)
        rows = data.get("actions" if viewer else "ops", [])
        convert = to_viewer_action if viewer else to_plan_op
        ops = [op for raw in rows if isinstance(raw, dict) if (op := convert(raw))]
        return AssistantReply(ops=ops, reply=str(data.get("reply", "")).strip())

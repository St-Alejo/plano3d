"""Claude como intérprete del chat del editor (respaldo del intérprete local).

Recibe el mensaje y un resumen del plano (ambientes con su rectángulo y aberturas por
lado) y responde con salida estructurada (JSON Schema): la lista de operaciones del
lenguaje del chat (``planOps.ts``) y una frase de respuesta. No toca el modelo: el
editor aplica las operaciones como un solo comando deshacible.

Cada llamada pasa por el mismo tope de gasto y caché que la lectura de cotas.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from plano3d.application.ports import AssistantReply, PlanAssistant
from plano3d.application.use_cases.errors import AssistantUnavailableError
from plano3d.infrastructure.ocr.budget import PRICES, ClaudeBudget, ResponseCache

log = logging.getLogger(__name__)

MODEL = "claude-sonnet-5-5"
OPS = [
    "add_room",
    "add_opening",
    "delete_opening",
    "move_opening",
    "rename_room",
    "delete_room",
    "add_furniture",
]
SIDES = ["norte", "sur", "este", "oeste"]

_SYSTEM = (
    "Eres el asistente de un editor de planos arquitectónicos en español. Conviertes lo que "
    "pide la persona en operaciones del editor. Convención: norte = arriba del plano, sur = "
    "abajo, este = derecha, oeste = izquierda; medidas en metros, ancho (este-oeste) por fondo "
    "(norte-sur). Usa los nombres de ambientes que existen en el plano (te los doy) o los que "
    "se crean en el mismo mensaje. Operaciones:\n"
    "- add_room: name, width, depth y opcional next_room+next_side (lado del ambiente de "
    "referencia donde va el nuevo).\n"
    "- add_opening: kind (door|window), room y side, o room+between (otro ambiente) para "
    "una puerta entre dos ambientes; width opcional.\n"
    "- delete_opening: room, kind y side opcionales.\n"
    "- move_opening: room, kind y from_side opcionales, to_side y to_room opcional.\n"
    "- rename_room: room y name. delete_room: room. add_furniture: item (mueble) y room.\n"
    "Si algo no se puede expresar con estas operaciones, no inventes: deja ops vacío y "
    "explícalo en reply. reply es una frase breve en español."
)

_NULLABLE_STR = {"type": ["string", "null"]}
_NULLABLE_NUM = {"type": ["number", "null"]}
_SIDE = {"type": ["string", "null"], "enum": [*SIDES, None]}
_OP_FIELDS: dict[str, Any] = {
    "op": {"type": "string", "enum": OPS},
    "name": _NULLABLE_STR,
    "width": _NULLABLE_NUM,
    "depth": _NULLABLE_NUM,
    "next_room": _NULLABLE_STR,
    "next_side": _SIDE,
    "kind": {"type": ["string", "null"], "enum": ["door", "window", None]},
    "room": _NULLABLE_STR,
    "side": _SIDE,
    "between": _NULLABLE_STR,
    "from_side": _SIDE,
    "to_side": _SIDE,
    "to_room": _NULLABLE_STR,
    "item": _NULLABLE_STR,
}
SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "ops": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": _OP_FIELDS,
                "required": list(_OP_FIELDS),
                "additionalProperties": False,
            },
        },
        "reply": {"type": "string"},
    },
    "required": ["ops", "reply"],
    "additionalProperties": False,
}


def to_plan_op(raw: dict[str, Any]) -> dict[str, object] | None:
    """Fila plana (campos nulos) → la forma de ``PlanOp`` del frontend; None si es inválida."""
    op = raw.get("op")
    f = {k: v for k, v in raw.items() if v is not None and k != "op"}
    try:
        if op == "add_room":
            out: dict[str, object] = {
                "op": op,
                "name": str(f["name"]),
                "width": float(f["width"]),
                "depth": float(f["depth"]),
            }
            if f.get("next_room") and f.get("next_side") in SIDES:
                out["next_to"] = {"room": str(f["next_room"]), "side": f["next_side"]}
            return out
        if op == "add_opening":
            keep = ("kind", "room", "side", "between", "width")
            return (
                {"op": op, **{k: f[k] for k in keep if k in f}}
                if "kind" in f and "room" in f
                else None
            )
        if op == "delete_opening":
            return (
                {"op": op, **{k: f[k] for k in ("kind", "room", "side") if k in f}}
                if "room" in f
                else None
            )
        if op == "move_opening":
            keep = ("kind", "room", "from_side", "to_side", "to_room")
            return (
                {"op": op, **{k: f[k] for k in keep if k in f}}
                if "room" in f and "to_side" in f
                else None
            )
        if op == "rename_room":
            return {"op": op, "room": str(f["room"]), "name": str(f["name"])}
        if op == "delete_room":
            return {"op": op, "room": str(f["room"])}
        if op == "add_furniture":
            return {"op": op, "item": str(f["item"]), "room": str(f["room"])}
    except (KeyError, TypeError, ValueError):
        return None
    return None


class ClaudePlanAssistant(PlanAssistant):
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

            self._client = anthropic.Anthropic(max_retries=2, timeout=60.0)
        return self._client

    async def interpret(self, message: str, context: str) -> AssistantReply:
        return await asyncio.to_thread(self._interpret, message, context)

    def _interpret(self, message: str, context: str) -> AssistantReply:
        user = f"Plano actual:\n{context or '(vacío)'}\n\nMensaje: {message}"
        key = ResponseCache.key(self._model, _SYSTEM, user)
        data = self._cache.get(key)
        if data is None:
            pin, pout = PRICES.get(self._model, PRICES["claude-opus-5-5"])
            estimate = ((len(_SYSTEM) + len(user)) / 3 * pin + 800 * pout) / 1e6
            if not self._budget.allows(estimate):
                raise AssistantUnavailableError("Se agotó el presupuesto del asistente con IA")
            data = self._call(user)
            self._cache.put(key, data)
        ops = [
            op for raw in data.get("ops", []) if isinstance(raw, dict) if (op := to_plan_op(raw))
        ]
        return AssistantReply(ops=ops, reply=str(data.get("reply", "")).strip())

    def _call(self, user: str) -> dict[str, Any]:
        try:
            import anthropic
        except ImportError as exc:
            raise AssistantUnavailableError("El SDK de Anthropic no está instalado") from exc
        try:
            response = self._api().messages.create(
                model=self._model,
                max_tokens=1500,
                system=_SYSTEM,
                output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
                messages=[{"role": "user", "content": user}],
            )
        except (anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
            log.warning("El asistente no respondió: %s", exc)
            raise AssistantUnavailableError(
                "El asistente con IA no respondió; intenta de nuevo"
            ) from exc
        usage = getattr(response, "usage", None)
        if usage is not None:
            self._budget.record(self._model, int(usage.input_tokens), int(usage.output_tokens))
        if response.stop_reason == "refusal":
            return {"ops": [], "reply": "No puedo ayudar con eso."}
        text = next((b.text for b in response.content if b.type == "text"), "")
        try:
            parsed: dict[str, Any] = json.loads(text)
        except json.JSONDecodeError as exc:
            raise AssistantUnavailableError("La respuesta del asistente no fue válida") from exc
        return parsed

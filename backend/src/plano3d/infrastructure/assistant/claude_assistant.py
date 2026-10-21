"""Claude como intérprete de los chats (respaldo del intérprete local).

Dos alcances: ``plan`` (chat del editor, operaciones sobre el plano) y ``viewer`` (chat de
la vista 3D, ajustes de cámara y de obra en ``viewerCommands.ts``).

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
    "set_wall",
    "resize_room",
    "set_opening",
    "set_floor",
]
SIDES = ["norte", "sur", "este", "oeste"]
WALL_KINDS = ["exterior", "interior", "partition"]

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
    "- set_wall: room y side opcionales (sin room = todos los muros del nivel) y lo que "
    "cambia: thickness (m), height (m), wall_kind (exterior|interior|partition = tabique), "
    "structural (true/false) o material (pañete blanco, pintura arena, pintura verde salvia, "
    "ladrillo a la vista, concreto).\n"
    "- resize_room: room y width y/o depth nuevos (m, de eje a eje).\n"
    "- set_opening: room, kind y side opcionales, y width, height o sill (antepecho) en m.\n"
    "- set_floor: room y material (madera roble, madera oscura, porcelanato claro, baldosa "
    "gris, cemento pulido).\n"
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
    "thickness": _NULLABLE_NUM,
    "height": _NULLABLE_NUM,
    "sill": _NULLABLE_NUM,
    "wall_kind": {"type": ["string", "null"], "enum": [*WALL_KINDS, None]},
    "structural": {"type": ["boolean", "null"]},
    "material": _NULLABLE_STR,
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


# ----------------------------------------------------------------------------- vista 3D

VIEWER_ACTIONS = [
    "plan_mode",
    "camera",
    "preset",
    "display",
    "quality",
    "roof",
    "brick",
    "masonry",
    "element",
    "step",
    "cut",
    "sun",
    "overlay",
    "room",
    "ask",
]
_VIEWER_VALUES: dict[str, list[str]] = {
    "plan_mode": ["presentacion", "obra", "acero", "secuencia"],
    "camera": ["orbit", "walk"],
    "preset": ["iso", "dollhouse", "top", "front"],
    "display": ["material", "wire", "xray"],
    "quality": ["alta", "baja"],
    "brick": ["tolete", "bloque5"],
    "ask": ["ladrillo", "cemento", "arena", "grava", "acero", "concreto", "area", "todo"],
}

_VIEWER_SYSTEM = (
    "Eres el asistente del visor 3D de un plano arquitectónico en español. No editas el "
    "plano: conviertes lo que pide la persona en ajustes de la vista. Cada acción es una "
    "fila con a (la acción) y, según la acción, value, number u on:\n"
    "- plan_mode: value presentacion|obra (maestro: ladrillo, columnetas, vigas)|acero "
    "(despiece)|secuencia (la obra paso a paso).\n"
    "- camera: value orbit|walk. preset: value iso|dollhouse (maqueta)|top (planta)|front.\n"
    "- display: value material|wire (alámbrico)|xray. quality: value alta|baja.\n"
    "- roof: on (cubierta de teja). masonry: on = se ve el ladrillo, false = solo el "
    "esqueleto de concreto. brick: value tolete|bloque5.\n"
    "- element: value con el id de un elemento de obra (C-3, VA-2, VC-1, SC-1, D-1, M-4).\n"
    "- step: number (paso desde 1) o value next|prev|last|play.\n"
    "- cut: on y number (altura del corte horizontal en m). sun: on y number (hora de 5 a 19).\n"
    "- overlay: number de 0 a 1 (opacidad del plano original). room: value con el nombre "
    "del ambiente al que ir.\n"
    "- ask: value ladrillo|cemento|arena|grava|acero|concreto|area|todo para preguntas de "
    "cantidades de obra (las calcula el visor).\n"
    "Usa los nombres e ids que te doy en el estado. Si algo no se puede expresar con estas "
    "acciones, deja actions vacío y explícalo en reply. reply es una frase breve en español."
)

_VIEWER_ROW: dict[str, Any] = {
    "a": {"type": "string", "enum": VIEWER_ACTIONS},
    "value": _NULLABLE_STR,
    "number": _NULLABLE_NUM,
    "on": {"type": ["boolean", "null"]},
}
VIEWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "actions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": _VIEWER_ROW,
                "required": list(_VIEWER_ROW),
                "additionalProperties": False,
            },
        },
        "reply": {"type": "string"},
    },
    "required": ["actions", "reply"],
    "additionalProperties": False,
}

_KEY = {
    "plan_mode": "id",
    "camera": "mode",
    "preset": "name",
    "display": "mode",
    "quality": "q",
    "brick": "id",
    "ask": "topic",
}


def to_viewer_action(raw: dict[str, Any]) -> dict[str, object] | None:
    """Fila plana → la forma de ``ViewerAction`` del frontend; None si es inválida."""
    a = raw.get("a")
    value, number, on = raw.get("value"), raw.get("number"), raw.get("on")
    if a in _KEY:
        return {"a": a, _KEY[a]: value} if value in _VIEWER_VALUES[a] else None
    if a == "roof" and isinstance(on, bool):
        return {"a": a, "on": on}
    if a == "masonry" and isinstance(on, bool):
        return {"a": a, "hidden": not on}
    if a in ("element", "room") and isinstance(value, str) and value.strip():
        return {"a": a, "id" if a == "element" else "room": value.strip()}
    if a == "step":
        if isinstance(number, int | float) and number >= 1:
            return {"a": a, "to": int(number)}
        return {"a": a, "to": value} if value in ("next", "prev", "last", "play") else None
    if a in ("cut", "sun") and isinstance(on, bool):
        out: dict[str, object] = {"a": a, "on": on}
        if isinstance(number, int | float):
            out["at" if a == "cut" else "hour"] = float(number)
        return out
    if a == "overlay" and isinstance(number, int | float) and 0 <= number <= 1:
        return {"a": a, "value": float(number)}
    return None


# ----------------------------------------------------------------------------- plano


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
        if op == "set_wall":
            changes = ("thickness", "height", "wall_kind", "structural", "material")
            if not any(k in f for k in changes):
                return None
            return {"op": op, **{k: f[k] for k in ("room", "side", *changes) if k in f}}
        if op == "resize_room":
            size: dict[str, object] = {k: float(f[k]) for k in ("width", "depth") if k in f}
            return {"op": op, "room": str(f["room"]), **size} if size else None
        if op == "set_opening":
            sizes = ("width", "height", "sill")
            if "room" not in f or not any(k in f for k in sizes):
                return None
            return {"op": op, **{k: f[k] for k in ("kind", "room", "side", *sizes) if k in f}}
        if op == "set_floor":
            return {"op": op, "room": str(f["room"]), "material": str(f["material"])}
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

    async def interpret(self, message: str, context: str, scope: str = "plan") -> AssistantReply:
        return await asyncio.to_thread(self._interpret, message, context, scope)

    def _interpret(self, message: str, context: str, scope: str = "plan") -> AssistantReply:
        viewer = scope == "viewer"
        system, schema = (_VIEWER_SYSTEM, VIEWER_SCHEMA) if viewer else (_SYSTEM, SCHEMA)
        label = "Estado de la vista" if viewer else "Plano actual"
        user = f"{label}:\n{context or '(vacío)'}\n\nMensaje: {message}"
        key = ResponseCache.key(self._model, system, user)
        data = self._cache.get(key)
        if data is None:
            pin, pout = PRICES.get(self._model, PRICES["claude-opus-5-5"])
            estimate = ((len(system) + len(user)) / 3 * pin + 800 * pout) / 1e6
            if not self._budget.allows(estimate):
                raise AssistantUnavailableError("Se agotó el presupuesto del asistente con IA")
            data = self._call(user, system, schema)
            self._cache.put(key, data)
        rows = data.get("actions" if viewer else "ops", [])
        convert = to_viewer_action if viewer else to_plan_op
        ops = [op for raw in rows if isinstance(raw, dict) if (op := convert(raw))]
        return AssistantReply(ops=ops, reply=str(data.get("reply", "")).strip())

    def _call(
        self, user: str, system: str = _SYSTEM, schema: dict[str, Any] = SCHEMA
    ) -> dict[str, Any]:
        try:
            import anthropic
        except ImportError as exc:
            raise AssistantUnavailableError("El SDK de Anthropic no está instalado") from exc
        try:
            response = self._api().messages.create(
                model=self._model,
                max_tokens=1500,
                system=system,
                output_config={"format": {"type": "json_schema", "schema": schema}},
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
            return {"ops": [], "actions": [], "reply": "No puedo ayudar con eso."}
        text = next((b.text for b in response.content if b.type == "text"), "")
        try:
            parsed: dict[str, Any] = json.loads(text)
        except json.JSONDecodeError as exc:
            raise AssistantUnavailableError("La respuesta del asistente no fue válida") from exc
        return parsed

"""Quién manda en qué cuando Interiores 3D edita en la sala en vivo (ADR-024).

Plano 3D es dueño de la **arquitectura**: niveles, muros, aberturas, polígonos de los
ambientes, columnas, escaleras, cotas, rótulos y la fachada. Interiores es dueño del
**interiorismo**: los muebles y el acabado de piso de cada ambiente. Esta regla la aplica el
servidor; la interfaz de Interiores solo la refleja (muros con candado).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Final

Json = dict[str, Any]

#: entidades que Interiores puede crear, cambiar y borrar libremente
INTERIOR_KINDS: Final[frozenset[str]] = frozenset({"furniture"})
#: campos de un ambiente que Interiores puede cambiar (lo demás es arquitectura)
ROOM_FINISH_FIELDS: Final[frozenset[str]] = frozenset({"floor_material"})
#: campos que el servidor recalcula y por eso no cuentan como cambio
ROOM_DERIVED: Final[frozenset[str]] = frozenset({"area", "centroid"})

ARCHITECTURE_REASON: Final = "La arquitectura se edita en Plano 3D"


def _find_room(model: Json, level_id: str | None, room_id: str | None) -> Json | None:
    for level in model.get("levels", []):
        if level.get("id") != level_id:
            continue
        return next((r for r in level.get("rooms", []) if r.get("id") == room_id), None)
    return None


def _only_finishes_changed(before: Json, after: Json) -> bool:
    ignored = ROOM_FINISH_FIELDS | ROOM_DERIVED
    keys = (set(before) | set(after)) - ignored
    return all(before.get(k) == after.get(k) for k in keys)


def interiores_violation(model: Json, ops: Sequence[Json]) -> str | None:
    """Motivo del rechazo si el lote toca la arquitectura; None si todo es interiorismo.

    ``model`` es el JSON actual de la sala (forma de ``BuildingModelDTO``).
    """
    for op in ops:
        kind, kind_op = op.get("k"), op.get("t")
        if kind in INTERIOR_KINDS:
            continue
        if kind == "room" and kind_op == "put" and isinstance(op.get("v"), dict):
            current = _find_room(model, op.get("level"), op.get("id"))
            if current is not None and _only_finishes_changed(current, op["v"]):
                continue
        return f"{ARCHITECTURE_REASON}: Interiores solo cambia muebles y acabados"
    return None

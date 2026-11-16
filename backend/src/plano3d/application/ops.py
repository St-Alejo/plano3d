"""Cambios por entidad («ops»): el idioma común de la edición en vivo (ADR-019).

Los dos editores (web y escritorio) y el servidor hablan el mismo idioma: una lista de
cambios sobre el JSON del modelo (la forma de ``BuildingModelDTO``), cada uno dirigido a
una entidad por su **id**, nunca por su posición. Así dos personas que editan cosas
distintas al mismo tiempo nunca se pisan, y si tocan la misma entidad gana la última que
llega al servidor (que es quien ordena).

    {"t": "put", "k": "wall", "level": "L1", "id": "w12", "v": {...muro completo}}
    {"t": "del", "k": "furniture", "level": "L2", "id": "f3"}
    {"t": "put", "k": "level", "id": "L3", "v": {"id": "L3", "name": "Piso 3", ...}}
    {"t": "set", "k": "model", "f": "facade", "v": "moderna_contemporanea"}

La misma semántica está escrita en TypeScript (``frontend/src/domain/ops.ts``) y en C#
(``desktop/src/Plano3D.Core/Ops``); los casos de ``tests/fixtures/ops`` la fijan en las
tres. Este módulo trabaja sobre diccionarios JSON y no valida reglas del edificio: eso lo
hace ``apply_ops_to_model`` al reconstruir el dominio.
"""

from __future__ import annotations

import copy
from collections.abc import Iterable, Sequence
from typing import Any, Final, Literal

from plano3d.application.dto import BuildingModelDTO, model_from_dto, model_to_dto
from plano3d.domain import BuildingModel
from plano3d.domain.errors import DomainError

Json = dict[str, Any]
OpType = Literal["put", "del", "set"]

#: entidad → lista del nivel donde vive
COLLECTIONS: Final[dict[str, str]] = {
    "wall": "walls",
    "room": "rooms",
    "column": "columns",
    "stair": "stairs",
    "dimension": "dimensions",
    "label": "labels",
    "furniture": "furniture",
}
#: campos del modelo que se cambian enteros con ``set``
MODEL_FIELDS: Final[tuple[str, ...]] = ("scale", "facade", "facade_custom", "source_image")
#: propiedades propias de un nivel (sin sus listas de entidades)
LEVEL_PROPS: Final[tuple[str, ...]] = ("id", "name", "elevation", "height")
#: campos de solo salida que el servidor recalcula: no cuentan como cambio
DERIVED: Final[dict[str, tuple[str, ...]]] = {
    "wall": ("length",),
    "room": ("area", "centroid"),
    "stair": ("tread",),
    "dimension": ("measured",),
}
OP_KINDS: Final[tuple[str, ...]] = ("model", "level", *COLLECTIONS)


class InvalidOpError(DomainError):
    """Un cambio mal formado o que apunta a un nivel que no existe."""


# ---------------------------------------------------------------- forma canónica
def canonical(value: Any) -> Any:
    """Quita los ``None`` (en el contrato ``None`` = valor por defecto) de forma recursiva."""
    if isinstance(value, dict):
        return {k: canonical(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [canonical(v) for v in value]
    return value


def canonical_entity(kind: str, value: Json) -> Json:
    out = canonical(value)
    for key in DERIVED.get(kind, ()):
        out.pop(key, None)
    return out  # type: ignore[no-any-return]


def _level_props(level: Json) -> Json:
    return canonical({k: level.get(k) for k in LEVEL_PROPS})  # type: ignore[no-any-return]


def _items(level: Json, kind: str) -> list[Json]:
    return list(level.get(COLLECTIONS[kind]) or [])


# ---------------------------------------------------------------- aplicar
def apply_ops(model: Json, ops: Iterable[Json]) -> Json:
    """Devuelve una copia del modelo con los cambios aplicados, en orden.

    Borrar algo que ya no existe no es error (otra persona pudo borrarlo antes): los
    cambios son idempotentes. Poner una entidad en un nivel inexistente sí lo es.
    """
    out: Json = copy.deepcopy(model)
    levels: list[Json] = out.setdefault("levels", [])
    for op in ops:
        _apply_one(out, levels, op)
    return out


def _apply_one(model: Json, levels: list[Json], op: Json) -> None:
    t, kind = op.get("t"), op.get("k")
    if t not in ("put", "del", "set") or kind not in OP_KINDS:
        raise InvalidOpError(f"Cambio desconocido: t={t!r}, k={kind!r}")
    if kind == "model":
        field = op.get("f")
        if t != "set" or field not in MODEL_FIELDS:
            raise InvalidOpError(f"Solo se puede hacer set de {', '.join(MODEL_FIELDS)}")
        model[field] = copy.deepcopy(op.get("v"))
        return
    if t == "set":
        raise InvalidOpError("set solo aplica al modelo")
    entity_id = op.get("id")
    if not isinstance(entity_id, str) or not entity_id:
        raise InvalidOpError(f"El cambio {t} {kind} necesita id")
    if kind == "level":
        _apply_level(levels, t, entity_id, op.get("v"))
        return
    level = _find_level(levels, op.get("level"))
    key = COLLECTIONS[kind]
    items = _items(level, kind)
    if t == "del":
        level[key] = [it for it in items if it.get("id") != entity_id]
        return
    value = op.get("v")
    if not isinstance(value, dict) or value.get("id") != entity_id:
        raise InvalidOpError(f"put {kind} {entity_id}: v debe ser la entidad con el mismo id")
    value = copy.deepcopy(value)
    for i, it in enumerate(items):
        if it.get("id") == entity_id:
            items[i] = value
            break
    else:
        items.append(value)
    level[key] = items


def _apply_level(levels: list[Json], t: str, level_id: str, value: Any) -> None:
    if t == "del":
        levels[:] = [lv for lv in levels if lv.get("id") != level_id]
        return
    if not isinstance(value, dict) or value.get("id") != level_id:
        raise InvalidOpError(f"put level {level_id}: v debe ser el nivel con el mismo id")
    props = {k: copy.deepcopy(value[k]) for k in LEVEL_PROPS if k in value}
    for lv in levels:
        if lv.get("id") == level_id:
            for k in LEVEL_PROPS:
                if k != "id":
                    lv.pop(k, None)
            lv.update(props)
            return
    levels.append({**props, "walls": [], "rooms": []})


def _find_level(levels: list[Json], level_id: Any) -> Json:
    for lv in levels:
        if lv.get("id") == level_id:
            return lv
    raise InvalidOpError(f"El nivel {level_id!r} no existe")


# ---------------------------------------------------------------- comparar
def diff_models(before: Json, after: Json) -> list[Json]:
    """Cambios mínimos que llevan de ``before`` a ``after``.

    Orden: campos del modelo, niveles nuevos o cambiados, entidades (puestas y
    borradas, nivel por nivel) y al final niveles borrados, para que siempre se
    puedan aplicar en ese orden.
    """
    ops: list[Json] = []
    for field in MODEL_FIELDS:
        if canonical(before.get(field)) != canonical(after.get(field)):
            ops.append({"t": "set", "k": "model", "f": field, "v": copy.deepcopy(after.get(field))})

    old_levels = {lv["id"]: lv for lv in before.get("levels") or []}
    new_levels = {lv["id"]: lv for lv in after.get("levels") or []}
    for lid, lv in new_levels.items():
        old = old_levels.get(lid)
        if old is None or _level_props(old) != _level_props(lv):
            ops.append({"t": "put", "k": "level", "id": lid, "v": _level_props(lv)})
    for lid, lv in new_levels.items():
        ops.extend(_diff_level(lid, old_levels.get(lid, {}), lv))
    for lid in old_levels:
        if lid not in new_levels:
            ops.append({"t": "del", "k": "level", "id": lid})
    return ops


def _diff_level(level_id: str, before: Json, after: Json) -> list[Json]:
    ops: list[Json] = []
    for kind in COLLECTIONS:
        old = {it["id"]: it for it in _items(before, kind)}
        new = _items(after, kind)
        new_ids = {it["id"] for it in new}
        for oid in old:
            if oid not in new_ids:
                ops.append({"t": "del", "k": kind, "level": level_id, "id": oid})
        for it in new:
            prev = old.get(it["id"])
            if prev is None or canonical_entity(kind, prev) != canonical_entity(kind, it):
                ops.append(
                    {
                        "t": "put",
                        "k": kind,
                        "level": level_id,
                        "id": it["id"],
                        "v": canonical_entity(kind, it),
                    }
                )
    return ops


# ---------------------------------------------------------------- con el dominio
def model_json(model: BuildingModel) -> Json:
    """JSON del modelo tal como lo ven los clientes (con los derivados al día)."""
    return model_to_dto(model).model_dump(mode="json")


def apply_ops_to_model(model: BuildingModel, ops: Sequence[Json]) -> BuildingModel:
    """Aplica los cambios y reconstruye el dominio: si el resultado viola una regla del
    edificio (muro de 2 cm, abertura que no cabe, ambientes solapados) lanza
    ``DomainError`` y el modelo original queda intacto."""
    data = apply_ops(model_json(model), ops)
    data["project_id"] = model.project_id
    return model_from_dto(BuildingModelDTO.model_validate(data))

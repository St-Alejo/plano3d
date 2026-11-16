/**
 * Cambios por entidad («ops», ADR-019): el idioma común de la edición en vivo.
 *
 * Web, escritorio y servidor se mandan listas de cambios dirigidos a una entidad por su
 * id (nunca por su posición en la lista). Si dos personas tocan cosas distintas no se
 * pisan; si tocan la misma, gana la última que llega al servidor.
 *
 * Misma semántica que `backend/src/plano3d/application/ops.py` y que el núcleo C# del
 * escritorio: lo garantizan los casos de `__fixtures__/ops-cases.json` (copiados del
 * backend con `python scripts/export_openapi.py`).
 */
import type { BuildingModel, Level } from '@/api/types'

export const COLLECTIONS = {
  wall: 'walls',
  room: 'rooms',
  column: 'columns',
  stair: 'stairs',
  dimension: 'dimensions',
  label: 'labels',
  furniture: 'furniture',
} as const

export type EntityKind = keyof typeof COLLECTIONS
export const MODEL_FIELDS = ['scale', 'facade', 'facade_custom', 'source_image'] as const
export type ModelField = (typeof MODEL_FIELDS)[number]
const LEVEL_PROPS = ['id', 'name', 'elevation', 'height'] as const
/** Campos de solo salida que recalcula el servidor: no cuentan como cambio. */
const DERIVED: Partial<Record<EntityKind, readonly string[]>> = {
  wall: ['length'],
  room: ['area', 'centroid'],
  stair: ['tread'],
  dimension: ['measured'],
}

type Json = Record<string, unknown>
type Entity = Json & { id: string }

export type ModelOp =
  | { t: 'put'; k: EntityKind; level: string; id: string; v: Entity }
  | { t: 'del'; k: EntityKind; level: string; id: string }
  | { t: 'put'; k: 'level'; id: string; v: Json & { id: string } }
  | { t: 'del'; k: 'level'; id: string }
  | { t: 'set'; k: 'model'; f: ModelField; v: unknown }

export class InvalidOpError extends Error {}

// ---------------------------------------------------------------- forma canónica
/** Quita los `null`/`undefined` (en el contrato null = valor por defecto), en profundidad. */
export function canonical<T>(value: T): T {
  if (Array.isArray(value)) return value.map(canonical) as T
  if (value !== null && typeof value === 'object') {
    const out: Json = {}
    for (const [k, v] of Object.entries(value as Json)) if (v !== null && v !== undefined) out[k] = canonical(v)
    return out as T
  }
  return value
}

function canonicalEntity(kind: EntityKind, value: Json): Entity {
  const out = canonical(value)
  for (const key of DERIVED[kind] ?? []) delete out[key]
  return out as Entity
}

function levelProps(level: Json): Json & { id: string } {
  const out: Json = {}
  for (const k of LEVEL_PROPS) out[k] = level[k]
  return canonical(out) as Json & { id: string }
}

/** Igualdad estructural de JSON (el orden de las claves no importa). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]))
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && jsonEqual((a as Json)[k], (b as Json)[k]))
}

function items(level: Json, kind: EntityKind): Entity[] {
  return [...((level[COLLECTIONS[kind]] as Entity[] | null | undefined) ?? [])]
}

// ---------------------------------------------------------------- aplicar
/** Copia del modelo con los cambios aplicados en orden. Borrar algo que ya no existe no es error. */
export function applyOps(model: BuildingModel, ops: readonly ModelOp[]): BuildingModel {
  const out = structuredClone(model) as unknown as Json
  const levels = ((out.levels as Json[] | undefined) ??= [])
  for (const op of ops) applyOne(out, levels, op)
  return out as unknown as BuildingModel
}

function applyOne(model: Json, levels: Json[], op: ModelOp): void {
  const { t, k } = op as { t: unknown; k: unknown }
  if ((t !== 'put' && t !== 'del' && t !== 'set') || !(k === 'model' || k === 'level' || (typeof k === 'string' && k in COLLECTIONS)))
    throw new InvalidOpError(`Cambio desconocido: t=${String(t)}, k=${String(k)}`)
  if (op.k === 'model') {
    if (op.t !== 'set' || !MODEL_FIELDS.includes(op.f)) throw new InvalidOpError(`Solo se puede hacer set de ${MODEL_FIELDS.join(', ')}`)
    model[op.f] = structuredClone(op.v)
    return
  }
  if (t === 'set') throw new InvalidOpError('set solo aplica al modelo')
  if (typeof op.id !== 'string' || !op.id) throw new InvalidOpError(`El cambio ${op.t} ${op.k} necesita id`)
  if (op.k === 'level') {
    applyLevel(levels, op)
    return
  }
  const level = levels.find((lv) => lv.id === op.level)
  if (!level) throw new InvalidOpError(`El nivel ${JSON.stringify(op.level)} no existe`)
  const key = COLLECTIONS[op.k]
  const list = items(level, op.k)
  if (op.t === 'del') {
    level[key] = list.filter((it) => it.id !== op.id)
    return
  }
  if (!op.v || typeof op.v !== 'object' || op.v.id !== op.id)
    throw new InvalidOpError(`put ${op.k} ${op.id}: v debe ser la entidad con el mismo id`)
  const value = structuredClone(op.v)
  const i = list.findIndex((it) => it.id === op.id)
  if (i >= 0) list[i] = value
  else list.push(value)
  level[key] = list
}

function applyLevel(levels: Json[], op: Extract<ModelOp, { k: 'level' }>): void {
  if (op.t === 'del') {
    levels.splice(0, levels.length, ...levels.filter((lv) => lv.id !== op.id))
    return
  }
  if (!op.v || typeof op.v !== 'object' || op.v.id !== op.id)
    throw new InvalidOpError(`put level ${op.id}: v debe ser el nivel con el mismo id`)
  const props: Json = {}
  for (const k of LEVEL_PROPS) if (k in op.v) props[k] = structuredClone(op.v[k])
  const lv = levels.find((l) => l.id === op.id)
  if (lv) {
    for (const k of LEVEL_PROPS) if (k !== 'id') delete lv[k]
    Object.assign(lv, props)
  } else levels.push({ ...props, walls: [], rooms: [] })
}

// ---------------------------------------------------------------- comparar
/**
 * Cambios mínimos de `before` a `after`, en un orden que siempre se puede aplicar:
 * campos del modelo, niveles nuevos o cambiados, entidades y al final niveles borrados.
 */
export function diffModels(before: BuildingModel, after: BuildingModel): ModelOp[] {
  const b = before as unknown as Json
  const a = after as unknown as Json
  const ops: ModelOp[] = []
  for (const f of MODEL_FIELDS)
    if (!jsonEqual(canonical(b[f] ?? null), canonical(a[f] ?? null))) ops.push({ t: 'set', k: 'model', f, v: structuredClone(a[f]) })
  const oldLevels = new Map(((b.levels as Level[] | undefined) ?? []).map((lv) => [lv.id, lv as unknown as Json]))
  const newLevels = new Map(((a.levels as Level[] | undefined) ?? []).map((lv) => [lv.id, lv as unknown as Json]))
  for (const [id, lv] of newLevels) {
    const old = oldLevels.get(id)
    if (!old || !jsonEqual(levelProps(old), levelProps(lv))) ops.push({ t: 'put', k: 'level', id, v: levelProps(lv) })
  }
  for (const [id, lv] of newLevels) ops.push(...diffLevel(id, oldLevels.get(id) ?? {}, lv))
  for (const id of oldLevels.keys()) if (!newLevels.has(id)) ops.push({ t: 'del', k: 'level', id })
  return ops
}

function diffLevel(level: string, before: Json, after: Json): ModelOp[] {
  const ops: ModelOp[] = []
  for (const k of Object.keys(COLLECTIONS) as EntityKind[]) {
    const old = new Map(items(before, k).map((it) => [it.id, it]))
    const next = items(after, k)
    const nextIds = new Set(next.map((it) => it.id))
    for (const id of old.keys()) if (!nextIds.has(id)) ops.push({ t: 'del', k, level, id })
    for (const it of next) {
      const prev = old.get(it.id)
      const v = canonicalEntity(k, it)
      if (!prev || !jsonEqual(canonicalEntity(k, prev), v)) ops.push({ t: 'put', k, level, id: it.id, v })
    }
  }
  return ops
}

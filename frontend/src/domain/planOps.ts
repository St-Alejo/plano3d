/**
 * Lenguaje de operaciones del chat: lo que el intérprete local o Claude entienden de una
 * frase ("cocina de 3x3 al este de la sala con puerta al sur") se expresa como una lista
 * de `PlanOp` con referencias legibles (ambiente por nombre, muro por lado).
 *
 * `opsToCommand` las resuelve contra el modelo, en orden (una operación puede usar el
 * ambiente que creó la anterior), y devuelve UN comando compuesto: todo lo que hace el
 * chat se deshace con un solo Ctrl+Z.
 *
 * Convención de lados: norte = arriba del plano (y menor), sur = abajo, este = derecha,
 * oeste = izquierda.
 */
import type { BuildingModel, Level, Opening, OpeningKind, Room, Wall, WallKind } from '@/api/types'
import { CATALOG, type CatalogItem } from './catalog'
import {
  AddFurniture,
  AddOpening,
  CommandError,
  CompositeCommand,
  DeleteOpening,
  DeleteWall,
  MoveOpening,
  RelabelRoom,
  SetFloorMaterial,
  TranslateWalls,
  UpdateOpening,
  UpdateWall,
  type Command,
} from './commands'
import { DEFAULT_WALL, DrawRoom, MIN_ROOM_SIDE, type Rect } from './drawing'
import { FLOOR_MATERIALS, WALL_MATERIALS, type MaterialSpec } from './materials'
import { findLevel, polygonCentroid, replaceLevel, wallLength } from './model'
import { placeOpening } from './openings'
import { recomputeRooms } from './rooms'

export const SIDES = ['norte', 'sur', 'este', 'oeste'] as const
export type Side = (typeof SIDES)[number]

export type PlanOp =
  | { op: 'add_room'; name: string; width: number; depth: number; next_to?: { room: string; side: Side }; at?: { x: number; y: number } }
  | { op: 'add_opening'; kind: OpeningKind; room: string; side?: Side; between?: string; width?: number }
  | { op: 'delete_opening'; kind?: OpeningKind; room: string; side?: Side }
  | { op: 'move_opening'; kind?: OpeningKind; room: string; from_side?: Side; to_side: Side; to_room?: string }
  | { op: 'rename_room'; room: string; name: string }
  | { op: 'delete_room'; room: string }
  | { op: 'add_furniture'; item: string; room: string }
  /** muros de un ambiente (o de un lado), o todos los del nivel si no se nombra ambiente */
  | { op: 'set_wall'; room?: string; side?: Side; thickness?: number; height?: number; wall_kind?: WallKind; structural?: boolean; material?: string }
  /** medidas de eje a eje: corre el muro este (ancho) y el sur (fondo) */
  | { op: 'resize_room'; room: string; width?: number; depth?: number }
  | { op: 'set_opening'; kind?: OpeningKind; room: string; side?: Side; width?: number; height?: number; sill?: number }
  | { op: 'set_floor'; room: string; material: string }

export interface PlanResult {
  command: Command
  /** resumen en español de lo que se hizo, para la respuesta del chat */
  summary: string[]
}

/** minúsculas y sin tildes, para comparar nombres */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

// ----------------------------------------------------------------------------- geometría de ambientes

/** Rectángulo de ejes de muro que encierra un ambiente (su polígono es la cara interior). */
export function roomRect(room: Room, thickness: number): Rect {
  const xs = room.polygon.map((p) => p.x)
  const ys = room.polygon.map((p) => p.y)
  const h = thickness / 2
  const x0 = Math.min(...xs) - h
  const y0 = Math.min(...ys) - h
  return { x: x0, y: y0, w: Math.max(...xs) + h - x0, h: Math.max(...ys) + h - y0 }
}

const thicknessOf = (lv: Level) => lv.walls[0]?.thickness ?? DEFAULT_WALL.thickness

interface SideWall {
  wall: Wall
  /** tramo del muro que bordea el ambiente, en m a lo largo del muro */
  from: number
  to: number
}

/** Muros sobre un lado del ambiente (con el tramo que lo bordea), el más largo primero. */
export function wallsOnSide(level: Level, room: Room, side: Side): SideWall[] {
  const t = thicknessOf(level)
  const r = roomRect(room, t)
  const horizontal = side === 'norte' || side === 'sur'
  const line = side === 'norte' ? r.y : side === 'sur' ? r.y + r.h : side === 'oeste' ? r.x : r.x + r.w
  const [lo, hi] = horizontal ? [r.x, r.x + r.w] : [r.y, r.y + r.h]
  const out: SideWall[] = []
  for (const w of level.walls) {
    const tol = w.thickness / 2 + 0.05
    const across = (p: { x: number; y: number }) => (horizontal ? p.y : p.x)
    const along = (p: { x: number; y: number }) => (horizontal ? p.x : p.y)
    if (Math.abs(across(w.start) - line) > tol || Math.abs(across(w.end) - line) > tol) continue
    const a = along(w.start)
    const b = along(w.end)
    const s = Math.max(lo, Math.min(a, b))
    const e = Math.min(hi, Math.max(a, b))
    if (e - s < 0.3) continue
    // a lo largo del muro (desde su inicio)
    const toWall = (v: number) => Math.abs(v - a)
    const f = Math.min(toWall(s), toWall(e))
    out.push({ wall: w, from: f, to: f + (e - s) })
  }
  return out.sort((x, y) => y.to - y.from - (x.to - x.from))
}

/** Lado del ambiente `a` que mira hacia el ambiente `b` (para "puerta entre la sala y la cocina"). */
export function sideFacing(a: Room, b: Room, t: number): Side {
  const ra = roomRect(a, t)
  const rb = roomRect(b, t)
  const dx = rb.x + rb.w / 2 - (ra.x + ra.w / 2)
  const dy = rb.y + rb.h / 2 - (ra.y + ra.h / 2)
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'este' : 'oeste'
  return dy > 0 ? 'sur' : 'norte'
}

// ----------------------------------------------------------------------------- referencias

export function findRoom(level: Level, name: string): Room {
  const q = fold(name).replace(/^(la|el|los|las)\s+/, '')
  const rooms = level.rooms
  const hit =
    rooms.find((r) => fold(r.label) === q) ??
    rooms.find((r) => fold(r.label).startsWith(q)) ??
    rooms.find((r) => fold(r.label).includes(q)) ??
    rooms.find((r) => q.includes(fold(r.label)))
  if (!hit) {
    const known = rooms.map((r) => r.label).join(', ')
    throw new CommandError(`No encuentro el ambiente «${name}»${known ? ` (hay: ${known})` : ''}`)
  }
  return hit
}

function openingsOf(level: Level, room: Room, side?: Side, kind?: OpeningKind): { wall: Wall; opening: Opening; side: Side }[] {
  const sides = side ? [side] : SIDES
  const out: { wall: Wall; opening: Opening; side: Side }[] = []
  for (const s of sides)
    for (const sw of wallsOnSide(level, room, s))
      for (const o of sw.wall.openings) {
        const mid = o.offset + o.width / 2
        if (mid >= sw.from - 0.05 && mid <= sw.to + 0.05 && (!kind || o.kind === kind)) out.push({ wall: sw.wall, opening: o, side: s })
      }
  return out
}

export function findCatalogItem(text: string): CatalogItem {
  const q = fold(text)
  const scored = CATALOG.map((c) => {
    const name = fold(c.name)
    const score = name === q ? 3 : name.startsWith(q) || q.startsWith(name) ? 2 : name.includes(q) || q.split(/\s+/).some((w) => w.length > 3 && name.includes(w)) ? 1 : 0
    return { c, score }
  }).filter((x) => x.score > 0)
  scored.sort((a, b) => b.score - a.score)
  if (!scored[0]) throw new CommandError(`No tengo «${text}» en el catálogo de muebles`)
  return scored[0].c
}

/** Acabado por nombre o palabra suelta ("madera", "blanco", "ladrillo"). */
export function findMaterial(list: MaterialSpec[], text: string): MaterialSpec {
  const q = fold(text).replace(/^(?:el|la|un|una)\s+/, '')
  const words = q.split(/[\s_]+/).filter((w) => w.length > 3)
  const hit =
    list.find((m) => m.id === q || fold(m.name) === q) ??
    list.find((m) => fold(m.name).startsWith(q)) ??
    list.find((m) => words.some((w) => fold(m.name).includes(w) || m.id.includes(w)))
  if (!hit) throw new CommandError(`No conozco el acabado «${text}» (hay: ${list.map((m) => m.name.toLowerCase()).join(', ')})`)
  return hit
}

const WALL_KIND: Record<WallKind, string> = { unknown: 'sin tipo', exterior: 'exterior', interior: 'interior', partition: 'tabique' }

/** Muros de un ambiente: los de un lado o todos los que lo encierran, sin repetir. */
function roomWalls(level: Level, room: Room, side?: Side): Wall[] {
  const byId = new Map((side ? [side] : SIDES).flatMap((s) => wallsOnSide(level, room, s)).map((x) => [x.wall.id, x.wall] as const))
  return [...byId.values()]
}

/** Los ambientes se recalculan al despachar; al encadenar operaciones hay que hacerlo aquí. */
function withRooms(model: BuildingModel, levelId: string): BuildingModel {
  const lv = findLevel(model, levelId)
  return replaceLevel(model, { ...lv, rooms: recomputeRooms(lv) })
}

// ----------------------------------------------------------------------------- ejecución

const KIND = { door: 'puerta', window: 'ventana' } as const

/** Dónde va un ambiente nuevo: junto a otro, en un punto, o a la derecha de todo lo dibujado. */
function placeRoom(level: Level, op: Extract<PlanOp, { op: 'add_room' }>): Rect {
  const t = thicknessOf(level)
  if (op.at) return { x: op.at.x, y: op.at.y, w: op.width, h: op.depth }
  if (op.next_to) {
    const r = roomRect(findRoom(level, op.next_to.room), t)
    switch (op.next_to.side) {
      case 'este':
        return { x: r.x + r.w, y: r.y, w: op.width, h: op.depth }
      case 'oeste':
        return { x: r.x - op.width, y: r.y, w: op.width, h: op.depth }
      case 'norte':
        return { x: r.x, y: r.y - op.depth, w: op.width, h: op.depth }
      case 'sur':
        return { x: r.x, y: r.y + r.h, w: op.width, h: op.depth }
    }
  }
  if (level.walls.length === 0) return { x: 0, y: 0, w: op.width, h: op.depth }
  const xs = level.walls.flatMap((w) => [w.start.x, w.end.x])
  const ys = level.walls.flatMap((w) => [w.start.y, w.end.y])
  return { x: Math.max(...xs), y: Math.min(...ys), w: op.width, h: op.depth }
}

/** Opera sobre `model` y devuelve el comando de esa operación ya ejecutado (para encadenar). */
function step(model: BuildingModel, levelId: string, op: PlanOp): { cmd: Command; model: BuildingModel; summary: string } {
  const level = findLevel(model, levelId)
  const run = (cmd: Command, summary: string) => ({ cmd, model: cmd.execute(model), summary })
  switch (op.op) {
    case 'add_room': {
      if (!(op.width > 0 && op.depth > 0)) throw new CommandError('El ambiente necesita ancho y fondo')
      const rect = placeRoom(level, op)
      const tpl = level.walls[0]
      const cmd = new DrawRoom(levelId, level, rect, cap(op.name), { thickness: tpl?.thickness, height: tpl?.height })
      return run(cmd, `Dibujé ${cap(op.name)} de ${fmt(op.width)} × ${fmt(op.depth)} m`)
    }
    case 'add_opening': {
      const room = findRoom(level, op.room)
      const other = op.between ? findRoom(level, op.between) : undefined
      const side = op.side ?? (other ? sideFacing(room, other, thicknessOf(level)) : op.kind === 'door' ? 'sur' : 'norte')
      const candidates = wallsOnSide(level, room, side)
      if (candidates.length === 0) throw new CommandError(`${room.label} no tiene muro al ${side}`)
      const width = op.width ?? (op.kind === 'door' ? 0.9 : 1.2)
      for (const sw of candidates) {
        const p = placeOpening(sw.wall, width, (sw.from + sw.to) / 2, undefined, 0.05)
        if (!p.ok) continue
        const cmd = new AddOpening(levelId, sw.wall.id, op.kind, p.offset + width / 2, wallLength(sw.wall))
        // AddOpening usa el ancho estándar: si se pidió otro, se ajusta en el mismo comando
        const fixed: Command =
          width === cmd.opening.width ? cmd : new CompositeCommand(cmd.label, [cmd, new UpdateOpening(levelId, sw.wall.id, cmd.opening.id, { offset: p.offset, width })])
        const where = other ? `entre ${room.label} y ${other.label}` : `al ${side} de ${room.label}`
        return run(fixed, `Agregué una ${KIND[op.kind]} ${where}`)
      }
      throw new CommandError(`No cabe una ${KIND[op.kind]} de ${fmt(width)} m al ${side} de ${room.label}`)
    }
    case 'delete_opening': {
      const room = findRoom(level, op.room)
      const [hit] = openingsOf(level, room, op.side, op.kind)
      if (!hit) throw new CommandError(`No encuentro ${op.kind ? `una ${KIND[op.kind]}` : 'una puerta o ventana'} en ${room.label}${op.side ? ` al ${op.side}` : ''}`)
      return run(new DeleteOpening(levelId, hit.wall.id, hit.opening.id), `Quité la ${KIND[hit.opening.kind]} del ${hit.side} de ${room.label}`)
    }
    case 'move_opening': {
      const room = findRoom(level, op.room)
      const [hit] = openingsOf(level, room, op.from_side, op.kind)
      if (!hit) throw new CommandError(`No encuentro ${op.kind ? `una ${KIND[op.kind]}` : 'una puerta o ventana'} en ${room.label}`)
      const target = op.to_room ? findRoom(level, op.to_room) : room
      for (const sw of wallsOnSide(level, target, op.to_side)) {
        const p = placeOpening(sw.wall, hit.opening.width, (sw.from + sw.to) / 2, hit.opening.id, 0.05)
        if (!p.ok) continue
        return run(new MoveOpening(levelId, hit.opening.id, sw.wall.id, p.offset), `Moví la ${KIND[hit.opening.kind]} al ${op.to_side} de ${target.label}`)
      }
      throw new CommandError(`La ${KIND[hit.opening.kind]} no cabe al ${op.to_side} de ${target.label}`)
    }
    case 'rename_room': {
      const room = findRoom(level, op.room)
      return run(new RelabelRoom(levelId, room.id, cap(op.name)), `Renombré ${room.label} a ${cap(op.name)}`)
    }
    case 'delete_room': {
      const room = findRoom(level, op.room)
      // solo los muros que no comparte con otro ambiente
      const others = level.rooms.filter((r) => r.id !== room.id)
      const shared = new Set(others.flatMap((r) => SIDES.flatMap((s) => wallsOnSide(level, r, s).map((x) => x.wall.id))))
      const own = [...new Set(SIDES.flatMap((s) => wallsOnSide(level, room, s).map((x) => x.wall.id)))].filter((id) => !shared.has(id))
      if (own.length === 0) throw new CommandError(`${room.label} solo tiene muros compartidos: bórralos a mano`)
      return run(new CompositeCommand(`Eliminar ${room.label}`, own.map((id) => new DeleteWall(levelId, id))), `Eliminé ${room.label}`)
    }
    case 'add_furniture': {
      const room = findRoom(level, op.room)
      const item = findCatalogItem(op.item)
      return run(new AddFurniture(levelId, item.id, polygonCentroid(room.polygon)), `Puse ${item.name.toLowerCase()} en ${room.label}`)
    }
    case 'set_wall': {
      const room = op.room ? findRoom(level, op.room) : undefined
      const walls = room ? roomWalls(level, room, op.side) : level.walls
      if (walls.length === 0) throw new CommandError(room ? `${room.label} no tiene muro${op.side ? ` al ${op.side}` : 's'}` : 'Este nivel no tiene muros')
      const patch: Partial<Pick<Wall, 'thickness' | 'height' | 'material' | 'kind' | 'structural'>> = {}
      const said: string[] = []
      if (op.thickness !== undefined) {
        if (!(op.thickness >= 0.05 && op.thickness <= 1)) throw new CommandError('El espesor del muro va entre 5 y 100 cm')
        patch.thickness = op.thickness
        said.push(`espesor ${fmt(op.thickness)} m`)
      }
      if (op.height !== undefined) {
        if (!(op.height >= 0.3 && op.height <= 12)) throw new CommandError('La altura del muro va entre 0,3 y 12 m')
        patch.height = op.height
        said.push(`altura ${fmt(op.height)} m`)
      }
      if (op.wall_kind) {
        patch.kind = op.wall_kind
        said.push(WALL_KIND[op.wall_kind])
      }
      if (op.structural !== undefined) {
        patch.structural = op.structural
        said.push(op.structural ? 'estructural' : 'no estructural')
      }
      if (op.material) {
        const mat = findMaterial(WALL_MATERIALS, op.material)
        patch.material = mat.id
        said.push(mat.name.toLowerCase())
      }
      if (said.length === 0) throw new CommandError('No dijiste qué cambiar de los muros')
      const where = room ? (op.side ? `del muro ${op.side} de ${room.label}` : `de los muros de ${room.label}`) : 'de todos los muros'
      const parts = walls.map((w) => new UpdateWall(levelId, w.id, patch))
      const cmd = parts.length === 1 ? parts[0]! : new CompositeCommand(`Editar ${parts.length} muros`, parts)
      return run(cmd, `Cambié ${where}: ${said.join(', ')}`)
    }
    case 'resize_room': {
      const room = findRoom(level, op.room)
      const r = roomRect(room, thicknessOf(level))
      const parts: Command[] = []
      let m = model
      // el muro este se corre para el ancho y el sur para el fondo; los muros que llegan a ellos se estiran
      const shift = (value: number | undefined, current: number, side: Side, what: string) => {
        if (value === undefined) return
        if (!(value >= MIN_ROOM_SIDE + thicknessOf(level))) throw new CommandError(`El ${what} de ${room.label} es muy pequeño`)
        const d = value - current
        if (Math.abs(d) < 0.005) return
        const ids = wallsOnSide(findLevel(m, levelId), room, side).map((x) => x.wall.id)
        if (ids.length === 0) throw new CommandError(`${room.label} no tiene muro al ${side}`)
        const c = side === 'este' ? new TranslateWalls(levelId, ids, d, 0) : new TranslateWalls(levelId, ids, 0, d)
        m = c.execute(m)
        parts.push(c)
      }
      shift(op.width, r.w, 'este', 'ancho')
      shift(op.depth, r.h, 'sur', 'fondo')
      if (parts.length === 0) throw new CommandError(`${room.label} ya mide eso`)
      const w = op.width ?? r.w
      const h = op.depth ?? r.h
      const cmd = parts.length === 1 ? parts[0]! : new CompositeCommand(`Cambiar tamaño de ${room.label}`, parts)
      return { cmd, model: withRooms(m, levelId), summary: `${room.label} ahora mide ${fmt(round(w))} × ${fmt(round(h))} m` }
    }
    case 'set_opening': {
      const room = findRoom(level, op.room)
      const [hit] = openingsOf(level, room, op.side, op.kind)
      if (!hit) throw new CommandError(`No encuentro ${op.kind ? `una ${KIND[op.kind]}` : 'una puerta o ventana'} en ${room.label}${op.side ? ` al ${op.side}` : ''}`)
      const o = hit.opening
      const patch: Partial<Omit<Opening, 'id'>> = {}
      const said: string[] = []
      if (op.width !== undefined) {
        if (!(op.width >= 0.3)) throw new CommandError('El ancho mínimo es 0,3 m')
        // crece hacia los dos lados desde su centro, sin pisar otra abertura
        const p = placeOpening(hit.wall, op.width, o.offset + o.width / 2, o.id, 0.05)
        if (!p.ok) throw new CommandError(`Una ${KIND[o.kind]} de ${fmt(op.width)} m no cabe en ese muro`)
        patch.offset = p.offset
        patch.width = op.width
        said.push(`ancho ${fmt(op.width)} m`)
      }
      if (op.sill !== undefined) {
        patch.sill = op.sill
        said.push(`antepecho ${fmt(op.sill)} m`)
      }
      if (op.height !== undefined) {
        patch.height = op.height
        said.push(`alto ${fmt(op.height)} m`)
      }
      if (said.length === 0) throw new CommandError('No dijiste qué cambiar de la abertura')
      if ((patch.sill ?? o.sill) + (patch.height ?? o.height) > hit.wall.height + 1e-6) throw new CommandError(`La ${KIND[o.kind]} queda más alta que el muro (${fmt(hit.wall.height)} m)`)
      return run(new UpdateOpening(levelId, hit.wall.id, o.id, patch), `Ajusté la ${KIND[o.kind]} del ${hit.side} de ${room.label}: ${said.join(', ')}`)
    }
    case 'set_floor': {
      const room = findRoom(level, op.room)
      const mat = findMaterial(FLOOR_MATERIALS, op.material)
      return run(new SetFloorMaterial(levelId, room.id, mat.id), `Puse piso de ${mat.name.toLowerCase()} en ${room.label}`)
    }
  }
}

const round = (v: number) => Math.round(v * 100) / 100

const cap = (s: string) => {
  const t = s.trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '')).replace('.', ',')

/** Resuelve y encadena las operaciones; si una falla, no se aplica ninguna. */
export function opsToCommand(model: BuildingModel, levelId: string, ops: PlanOp[]): PlanResult {
  if (ops.length === 0) throw new CommandError('No hay nada que hacer')
  let m = model
  const parts: Command[] = []
  const summary: string[] = []
  for (const op of ops) {
    const r = step(m, levelId, op)
    parts.push(r.cmd)
    summary.push(r.summary)
    m = r.model
  }
  // se deshacen para que el store los aplique como un solo paso del historial
  for (const c of [...parts].reverse()) m = c.undo(m)
  const label = parts.length === 1 ? parts[0]!.label : `Chat: ${parts.length} cambios`
  return { command: parts.length === 1 ? parts[0]! : new CompositeCommand(label, parts), summary }
}

/** Resumen del nivel para el asistente: ambientes con su rectángulo y aberturas por lado. */
export function describeLevel(level: Level): string {
  if (level.rooms.length === 0) return level.walls.length === 0 ? '(vacío)' : `${level.walls.length} muros sueltos, sin ambientes cerrados`
  const t = thicknessOf(level)
  return level.rooms
    .map((room) => {
      const r = roomRect(room, t)
      const ops = openingsOf(level, room).map((o) => `${KIND[o.opening.kind]} al ${o.side}`)
      return `${room.label}: x ${fmt(r.x)}–${fmt(r.x + r.w)}, y ${fmt(r.y)}–${fmt(r.y + r.h)} (${fmt(r.w)} × ${fmt(r.h)} m)${ops.length ? `; ${ops.join(', ')}` : ''}`
    })
    .concat(`Muros: espesor ${fmt(t)} m, altura ${fmt(level.walls[0]?.height ?? DEFAULT_WALL.height)} m`)
    .join('\n')
}

const OPS = new Set([
  'add_room',
  'add_opening',
  'delete_opening',
  'move_opening',
  'rename_room',
  'delete_room',
  'add_furniture',
  'set_wall',
  'resize_room',
  'set_opening',
  'set_floor',
])

/** Filtra lo que llega del servidor: solo operaciones conocidas (lo demás se descarta). */
export function asPlanOps(raw: unknown): PlanOp[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((o): o is PlanOp => typeof o === 'object' && o !== null && OPS.has((o as { op?: string }).op ?? ''))
}

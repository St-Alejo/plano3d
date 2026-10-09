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
import type { BuildingModel, Level, Opening, OpeningKind, Room, Wall } from '@/api/types'
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
  UpdateOpening,
  type Command,
} from './commands'
import { DEFAULT_WALL, DrawRoom, type Rect } from './drawing'
import { findLevel, polygonCentroid, wallLength } from './model'
import { placeOpening } from './openings'

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
  }
}

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
    .join('\n')
}

const OPS = new Set(['add_room', 'add_opening', 'delete_opening', 'move_opening', 'rename_room', 'delete_room', 'add_furniture'])

/** Filtra lo que llega del servidor: solo operaciones conocidas (lo demás se descarta). */
export function asPlanOps(raw: unknown): PlanOp[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((o): o is PlanOp => typeof o === 'object' && o !== null && OPS.has((o as { op?: string }).op ?? ''))
}

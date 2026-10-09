/**
 * Dibujo rápido: un ambiente rectangular de una vez.
 *
 * Los lados que ya cubre un muro existente (p. ej. la pared que comparte con el
 * ambiente vecino) no se duplican: solo se crean los tramos que faltan. Así dibujar
 * "cocina al lado de la sala" deja un único muro entre las dos.
 */
import type { BuildingModel, Level, Point, Room, Wall } from '@/api/types'
import { CommandError, type Command } from './commands'
import { findLevel, MIN_WALL_LENGTH, newId, replaceLevel, validateWall } from './model'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const MIN_ROOM_SIDE = 0.5
export const DEFAULT_WALL = { thickness: 0.15, height: 2.6 } as const

/** Rectángulo normalizado (ancho y alto positivos) a partir de dos esquinas. */
export function rectFrom(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

/** Ejes de los cuatro lados en sentido horario: norte, este, sur, oeste. */
export function rectSides(r: Rect): [Point, Point][] {
  const tl = { x: r.x, y: r.y }
  const tr = { x: r.x + r.w, y: r.y }
  const br = { x: r.x + r.w, y: r.y + r.h }
  const bl = { x: r.x, y: r.y + r.h }
  return [
    [tl, tr],
    [tr, br],
    [br, bl],
    [bl, tl],
  ]
}

/** Tramos [t0, t1] (m a lo largo de p→q) que ya cubre algún muro colineal. */
function covered(walls: Wall[], p: Point, q: Point): [number, number][] {
  const len = Math.hypot(q.x - p.x, q.y - p.y)
  const d = { x: (q.x - p.x) / len, y: (q.y - p.y) / len }
  const out: [number, number][] = []
  for (const w of walls) {
    const tol = w.thickness / 2 + 0.02
    const off = (pt: Point) => Math.abs((pt.x - p.x) * d.y - (pt.y - p.y) * d.x)
    if (off(w.start) > tol || off(w.end) > tol) continue
    const t = (pt: Point) => (pt.x - p.x) * d.x + (pt.y - p.y) * d.y
    const lo = Math.max(0, Math.min(t(w.start), t(w.end)))
    const hi = Math.min(len, Math.max(t(w.start), t(w.end)))
    if (hi - lo > 1e-6) out.push([lo, hi])
  }
  return out.sort((a, b) => a[0] - b[0])
}

/** Tramos de p→q que todavía no tienen muro. */
export function missingSpans(walls: Wall[], p: Point, q: Point): [Point, Point][] {
  const len = Math.hypot(q.x - p.x, q.y - p.y)
  const at = (t: number) => ({ x: p.x + ((q.x - p.x) * t) / len, y: p.y + ((q.y - p.y) * t) / len })
  const gaps: [number, number][] = []
  let cursor = 0
  for (const [lo, hi] of covered(walls, p, q)) {
    if (lo > cursor + MIN_WALL_LENGTH) gaps.push([cursor, lo])
    cursor = Math.max(cursor, hi)
  }
  if (len > cursor + MIN_WALL_LENGTH) gaps.push([cursor, len])
  return gaps.map(([a, b]) => [at(a), at(b)])
}

/** Muros nuevos necesarios para cerrar el rectángulo `r` en el nivel. */
export function rectangleWalls(level: Level, r: Rect, template: Partial<Pick<Wall, 'thickness' | 'height'>> = {}): Wall[] {
  const thickness = template.thickness ?? DEFAULT_WALL.thickness
  const height = template.height ?? DEFAULT_WALL.height
  return rectSides(r).flatMap(([p, q]) =>
    missingSpans(level.walls, p, q).map(([a, b]) => ({
      id: newId('w'),
      start: a,
      end: b,
      thickness,
      height,
      material: 'plaster',
      openings: [],
      confidence: 1,
    })),
  )
}

/** Polígono interior (lo que queda libre entre muros) de un rectángulo de ejes. */
export function innerPolygon(r: Rect, thickness: number): Point[] {
  const h = thickness / 2
  return [
    { x: r.x + h, y: r.y + h },
    { x: r.x + r.w - h, y: r.y + h },
    { x: r.x + r.w - h, y: r.y + r.h - h },
    { x: r.x + h, y: r.y + r.h - h },
  ]
}

/**
 * Dibuja un ambiente: crea los muros que faltan y deja el nombre puesto. El store
 * recalcula los ambientes al cambiar los muros y conserva este nombre por superposición.
 */
export class DrawRoom implements Command {
  readonly label: string
  readonly walls: Wall[]
  readonly room: Room
  constructor(
    private readonly levelId: string,
    level: Level,
    readonly rect: Rect,
    name: string,
    template: Partial<Pick<Wall, 'thickness' | 'height'>> = {},
  ) {
    if (!(rect.w >= MIN_ROOM_SIDE && rect.h >= MIN_ROOM_SIDE)) throw new CommandError(`Un ambiente necesita al menos ${MIN_ROOM_SIDE} m por lado`)
    this.walls = rectangleWalls(level, rect, template)
    if (this.walls.length === 0) throw new CommandError('Ese ambiente ya está cerrado por muros: renómbralo en el panel')
    for (const w of this.walls) {
      const err = validateWall(w)
      if (err) throw new CommandError(err)
    }
    const label = name.trim() || 'Ambiente'
    this.label = `Dibujar ${label.toLowerCase()}`
    this.room = { id: newId('r'), label: label.slice(0, 60), polygon: innerPolygon(rect, template.thickness ?? DEFAULT_WALL.thickness), confidence: 1 }
  }
  execute(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    return replaceLevel(model, { ...lv, walls: [...lv.walls, ...this.walls], rooms: [...lv.rooms, this.room] })
  }
  undo(model: BuildingModel): BuildingModel {
    const ids = new Set(this.walls.map((w) => w.id))
    const lv = findLevel(model, this.levelId)
    return replaceLevel(model, { ...lv, walls: lv.walls.filter((w) => !ids.has(w.id)), rooms: lv.rooms.filter((r) => r.id !== this.room.id) })
  }
}

/**
 * Operaciones puras sobre el BuildingModel del contrato.
 *
 * Coordenadas de planta en METROS: x → derecha, y → abajo (igual que la imagen).
 * En 3D: X = x, Z = y, Y = arriba. Todas las funciones devuelven copias nuevas.
 */
import type { BuildingModel, Level, Opening, Point, Room, Wall } from '@/api/types'

export const EPS = 1e-6
export const MIN_WALL_LENGTH = 0.05

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function wallLength(w: Pick<Wall, 'start' | 'end'>): number {
  return distance(w.start, w.end)
}

export function wallDirection(w: Pick<Wall, 'start' | 'end'>): Point {
  const len = wallLength(w) || 1
  return { x: (w.end.x - w.start.x) / len, y: (w.end.y - w.start.y) / len }
}

export function pointAlong(w: Pick<Wall, 'start' | 'end'>, offset: number): Point {
  const d = wallDirection(w)
  return { x: w.start.x + d.x * offset, y: w.start.y + d.y * offset }
}

/** Distancia de un punto a un segmento y el desplazamiento a lo largo del muro. */
export function projectOnWall(w: Pick<Wall, 'start' | 'end'>, p: Point): { offset: number; distance: number } {
  const d = wallDirection(w)
  const len = wallLength(w)
  const raw = (p.x - w.start.x) * d.x + (p.y - w.start.y) * d.y
  const offset = Math.min(len, Math.max(0, raw))
  const q = pointAlong(w, offset)
  return { offset, distance: distance(p, q) }
}

export function polygonArea(points: Point[]): number {
  let acc = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    acc += a.x * b.y - b.x * a.y
  }
  return Math.abs(acc) / 2
}

export function polygonCentroid(points: Point[]): Point {
  let signed = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    const cross = a.x * b.y - b.x * a.y
    signed += cross
    cx += (a.x + b.x) * cross
    cy += (a.y + b.y) * cross
  }
  if (Math.abs(signed) < 1e-12) {
    const n = points.length || 1
    return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n }
  }
  signed *= 0.5
  return { x: cx / (6 * signed), y: cy / (6 * signed) }
}

export function roomArea(r: Room): number {
  return polygonArea(r.polygon)
}

export function totalArea(m: BuildingModel): number {
  return m.levels.reduce((s, lv) => s + lv.rooms.reduce((a, r) => a + roomArea(r), 0), 0)
}

/** Espejo de las invariantes del dominio (backend) para dar feedback instantáneo en el editor. */
export function validateWall(w: Wall): string | null {
  const len = wallLength(w)
  if (len < MIN_WALL_LENGTH) return 'El muro es demasiado corto'
  if (w.thickness <= 0 || w.height <= 0) return 'Grosor y altura deben ser positivos'
  const sorted = [...w.openings].sort((a, b) => a.offset - b.offset)
  for (const [i, o] of sorted.entries()) {
    if (o.offset < -EPS || o.offset + o.width > len + EPS) return 'La abertura se sale del muro'
    if (o.sill + o.height > w.height + EPS) return 'La abertura es más alta que el muro'
    const next = sorted[i + 1]
    if (next && next.offset < o.offset + o.width - EPS) return 'Las aberturas se solapan'
  }
  return null
}

export function findLevel(m: BuildingModel, levelId: string): Level {
  const lv = m.levels.find((l) => l.id === levelId)
  if (!lv) throw new Error(`Nivel ${levelId} no existe`)
  return lv
}

export function findWall(lv: Level, wallId: string): Wall {
  const w = lv.walls.find((x) => x.id === wallId)
  if (!w) throw new Error(`Muro ${wallId} no existe`)
  return w
}

export function replaceLevel(m: BuildingModel, level: Level): BuildingModel {
  return { ...m, levels: m.levels.map((l) => (l.id === level.id ? level : l)) }
}

export function upsertWall(lv: Level, wall: Wall): Level {
  const exists = lv.walls.some((w) => w.id === wall.id)
  return { ...lv, walls: exists ? lv.walls.map((w) => (w.id === wall.id ? wall : w)) : [...lv.walls, wall] }
}

export function removeWall(lv: Level, wallId: string): Level {
  return { ...lv, walls: lv.walls.filter((w) => w.id !== wallId) }
}

export function upsertRoom(lv: Level, room: Room): Level {
  const exists = lv.rooms.some((r) => r.id === room.id)
  return { ...lv, rooms: exists ? lv.rooms.map((r) => (r.id === room.id ? room : r)) : [...lv.rooms, room] }
}

/**
 * Mueve un extremo. Las aberturas conservan su distancia al extremo que NO se movió
 * (los offsets se miden desde el inicio, así que mover el inicio los recalcula). Para
 * movimientos a lo largo del muro equivale a no mover la abertura; para giros o
 * desplazamientos grandes nunca la empuja fuera del muro.
 */
export function moveWallEndpoint(w: Wall, end: 'start' | 'end', to: Point): Wall {
  if (end === 'end') return { ...w, end: to }
  const oldLen = wallLength(w)
  const newLen = wallLength({ start: to, end: w.end })
  return {
    ...w,
    start: to,
    openings: w.openings.map((o) => ({ ...o, offset: newLen - (oldLen - o.offset) })),
  }
}

/** Re-escala la geometría en planta (calibración). Las alturas son absolutas y no cambian. */
export function rescaleModel(m: BuildingModel, factor: number): BuildingModel {
  const sp = (p: Point): Point => ({ x: p.x * factor, y: p.y * factor })
  const so = (o: Opening): Opening => ({ ...o, offset: o.offset * factor, width: o.width * factor })
  return {
    ...m,
    scale: { meters_per_pixel: m.scale.meters_per_pixel * factor, source: 'calibrated', confidence: 1 },
    levels: m.levels.map((lv) => ({
      ...lv,
      walls: lv.walls.map((w) => ({
        ...w,
        start: sp(w.start),
        end: sp(w.end),
        thickness: w.thickness * factor,
        openings: w.openings.map(so),
      })),
      rooms: lv.rooms.map((r) => ({ ...r, polygon: r.polygon.map(sp) })),
    })),
  }
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  center: Point
  size: number
}

export function modelBounds(m: BuildingModel): Bounds {
  const pts = m.levels.flatMap((lv) => [
    ...lv.walls.flatMap((w) => [w.start, w.end]),
    ...lv.rooms.flatMap((r) => r.polygon),
  ])
  if (pts.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1, center: { x: 0.5, y: 0.5 }, size: 1 }
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return {
    minX,
    minY,
    maxX,
    maxY,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    size: Math.max(maxX - minX, maxY - minY, 1),
  }
}

let counter = 0
export function newId(prefix: string): string {
  counter += 1
  const rand = Math.random().toString(16).slice(2, 8)
  return `${prefix}_${Date.now().toString(16).slice(-4)}${rand}${counter}`
}

export const DOOR = { width: 0.9, height: 2.1, sill: 0 } as const
export const WINDOW = { width: 1.2, height: 1.2, sill: 0.9 } as const

/**
 * La escalera como se construye de verdad, deducida de los tramos del plano:
 * - en el último piso no se construye la escalera que no lleva a ningún piso (la copió «duplicar piso»);
 * - cada tramo es una losa inclinada con sus peldaños (perfil en diente de sierra), no bloques sueltos;
 * - baranda del lado del ojo de la escalera, continua por los descansos;
 * - el hueco de la losa de arriba lleva baranda en los bordes libres (no contra muros, ni donde
 *   llega o arranca un tramo).
 */
import type { BuildingModel, Level, Point, Stair, Wall } from '@/api/types'
import { STAIR_WAIST, stairWell } from './geometry'

/** Alto de la baranda sobre la nariz del peldaño y sobre el piso (m). */
export const RAIL_HEIGHT = 0.9
export const GUARD_HEIGHT = 0.95
/** Distancia a un muro para considerar que un borde del hueco ya está cerrado (m). */
const WALL_GAP = 0.25

interface StairLike {
  start: Point
  end: Point
  width: number
  steps: number
  riser: number
  base?: number | null
}

const sorted = (m: BuildingModel) => [...m.levels].sort((a, b) => a.elevation - b.elevation)

/**
 * El modelo con solo las escaleras que llevan a algún lado: en el piso más alto (con pisos debajo)
 * se quitan los tramos sin piso de llegada. Devuelve el mismo objeto si no hay nada que quitar.
 */
export function withRealStairs(m: BuildingModel): BuildingModel {
  const levels = sorted(m)
  if (levels.length < 2) return m
  const top = levels[levels.length - 1]!
  const ids = new Set(m.levels.map((l) => l.id))
  const dead = (top.stairs ?? []).filter((s) => !s.to_level_id || !ids.has(s.to_level_id) || s.to_level_id === top.id)
  if (dead.length === 0) return m
  return { ...m, levels: m.levels.map((l) => (l.id === top.id ? { ...l, stairs: (l.stairs ?? []).filter((s) => !dead.includes(s)) } : l)) }
}

function frame(s: StairLike) {
  const len = Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y) || 1
  const u = { x: (s.end.x - s.start.x) / len, y: (s.end.y - s.start.y) / len }
  return { len, u, n: { x: -u.y, y: u.x } }
}

/**
 * Perfil lateral del tramo en (a lo largo, alto) desde su arranque: los peldaños arriba y la losa
 * inclinada de `waist` de espesor abajo. Si arranca en un descanso baja hasta el fondo de ese descanso.
 */
export function flightProfile(s: StairLike, waist = STAIR_WAIST, landing = STAIR_WAIST * 1.5): Point[] {
  const { len } = frame(s)
  const t = len / s.steps
  const r = s.riser
  const slope = r / t
  // espesor vertical de la losa: la perpendicular `waist` medida en vertical
  const wv = waist * Math.hypot(1, slope)
  const pts: Point[] = [{ x: 0, y: 0 }]
  for (let i = 0; i < s.steps; i++) {
    pts.push({ x: t * i, y: r * (i + 1) }, { x: t * (i + 1), y: r * (i + 1) })
  }
  // borde de arriba del tramo: la losa baja `wv` bajo el último peldaño
  pts.push({ x: len, y: r * s.steps - wv })
  // la cara inferior es la recta h = slope·a − wv, hasta el piso (o el fondo del descanso)
  const floor = (s.base ?? 0) > 0 ? -landing : 0
  const a0 = (floor + wv) / slope
  if (a0 > 0) pts.push({ x: a0, y: floor })
  if (floor < 0) pts.push({ x: 0, y: floor })
  return pts
}

export interface Seg3 {
  a: [number, number, number]
  b: [number, number, number]
}

/** Lado del ojo de la escalera: hacia el centro de todos los tramos (o el lado más lejos de los muros). */
function innerSide(s: StairLike, all: StairLike[], walls: Wall[]): 1 | -1 {
  const { n } = frame(s)
  const mid = { x: (s.start.x + s.end.x) / 2, y: (s.start.y + s.end.y) / 2 }
  const c = all.reduce((acc, f) => ({ x: acc.x + (f.start.x + f.end.x) / 2 / all.length, y: acc.y + (f.start.y + f.end.y) / 2 / all.length }), { x: 0, y: 0 })
  const dot = (c.x - mid.x) * n.x + (c.y - mid.y) * n.y
  if (Math.abs(dot) > 0.05) return dot > 0 ? 1 : -1
  const clear = (k: number) => {
    const p = { x: mid.x + n.x * k * (s.width / 2 + 0.1), y: mid.y + n.y * k * (s.width / 2 + 0.1) }
    return Math.min(...walls.map((w) => distToSeg(p, w.start, w.end)), Infinity)
  }
  return clear(1) >= clear(-1) ? 1 : -1
}

function distToSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy || 1
  const k = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k))
}

/**
 * Baranda de los tramos de un piso (alturas desde el piso del nivel): un balaustre por peldaño,
 * pasamanos inclinado a 0,90 m sobre las narices y tramos de pasamanos que cruzan cada descanso.
 */
export function stairRailing(stairs: StairLike[], walls: Wall[] = []): { posts: Seg3[]; rails: Seg3[] } {
  const flights = [...stairs].sort((a, b) => (a.base ?? 0) - (b.base ?? 0))
  const posts: Seg3[] = []
  const rails: Seg3[] = []
  let prev: [number, number, number] | null = null
  for (const s of flights) {
    const { len, u, n } = frame(s)
    const t = len / s.steps
    const k = innerSide(s, flights, walls) * (s.width / 2 - 0.04)
    const at = (a: number, h: number): [number, number, number] => [s.start.x + u.x * a + n.x * k, h, s.start.y + u.y * a + n.y * k]
    const base = s.base ?? 0
    const tread = (i: number) => base + s.riser * (i + 1)
    for (let i = 0; i < s.steps; i++) posts.push({ a: at(t * (i + 0.5), tread(i)), b: at(t * (i + 0.5), tread(i) + RAIL_HEIGHT) })
    const first = at(t * 0.5, tread(0) + RAIL_HEIGHT)
    const last = at(t * (s.steps - 0.5), tread(s.steps - 1) + RAIL_HEIGHT)
    // tramos seguidos (hay descanso entre ellos): el pasamanos sigue de corrido por la esquina del ojo
    if (prev && Math.abs(prev[1] - (first[1] - s.riser)) < s.riser * 1.5 + 0.05) rails.push({ a: prev, b: first })
    rails.push({ a: first, b: last })
    prev = last
  }
  return { posts, rails }
}

/** Intervalo [t0, t1] de un borde que hay que dejar abierto. */
type Span = [number, number]

function subtract(len: number, cuts: Span[]): Span[] {
  let out: Span[] = [[0, len]]
  for (const [c0, c1] of cuts) {
    out = out.flatMap(([a, b]) => {
      if (c1 <= a || c0 >= b) return [[a, b] as Span]
      const res: Span[] = []
      if (c0 > a) res.push([a, c0])
      if (c1 < b) res.push([c1, b])
      return res
    })
  }
  return out.filter(([a, b]) => b - a > 0.15)
}

/**
 * Baranda del hueco de la escalera en la losa del piso `lv` (en planta): los bordes del hueco
 * que no dan contra un muro, menos donde llega el último tramo de abajo y donde arrancan los tramos
 * del propio piso.
 */
export function wellGuards(m: BuildingModel, lv: Level): { a: Point; b: Point }[] {
  const real = withRealStairs(m)
  const levels = sorted(real)
  const i = levels.findIndex((l) => l.id === lv.id)
  if (i <= 0) return []
  const below = levels[i - 1]!.stairs ?? []
  const well = stairWell(below)
  if (!well) return []
  const own = levels[i]!.stairs ?? []
  const corners = [
    { x: well.minX, y: well.minY },
    { x: well.maxX, y: well.minY },
    { x: well.maxX, y: well.maxY },
    { x: well.minX, y: well.maxY },
  ]
  // puntos por donde se entra o sale del hueco: el final del tramo más alto de abajo y el arranque
  // del tramo más bajo del piso (con su ancho)
  const top = [...below].sort((a, b) => (b.base ?? 0) - (a.base ?? 0))[0]
  const start = [...own].sort((a, b) => (a.base ?? 0) - (b.base ?? 0))[0]
  const doors: { p: Point; w: number }[] = []
  if (top) doors.push({ p: top.end, w: top.width })
  if (start) doors.push({ p: start.start, w: start.width })
  const walls = levels[i]!.walls
  const out: { a: Point; b: Point }[] = []
  for (let k = 0; k < 4; k++) {
    const a = corners[k]!
    const b = corners[(k + 1) % 4]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    // borde contra un muro paralelo: ya está cerrado
    const walled = walls.some((w) => {
      const wl = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) || 1
      const parallel = Math.abs(((w.end.x - w.start.x) / wl) * d.y - ((w.end.y - w.start.y) / wl) * d.x) < 0.05
      return parallel && distToSeg(mid, w.start, w.end) < WALL_GAP + w.thickness / 2
    })
    if (walled) continue
    const cuts: Span[] = doors
      .filter(({ p }) => distToSeg(p, a, b) < 0.2)
      .map(({ p, w }) => {
        const c = (p.x - a.x) * d.x + (p.y - a.y) * d.y
        return [c - w / 2 - 0.05, c + w / 2 + 0.05] as Span
      })
    for (const [t0, t1] of subtract(len, cuts)) out.push({ a: { x: a.x + d.x * t0, y: a.y + d.y * t0 }, b: { x: a.x + d.x * t1, y: a.y + d.y * t1 } })
  }
  return out
}

/** Tramos que se construyen en un piso (sin los que no llevan a ningún lado). */
export function realStairsOf(m: BuildingModel, levelId: string): Stair[] {
  return withRealStairs(m).levels.find((l) => l.id === levelId)?.stairs ?? []
}

/**
 * El piso de un ambiente con el hueco de la escalera recortado: el contorno del ambiente y, si el
 * hueco cae dentro, el hueco recortado al ambiente (para que no se dibuje baldosa sobre el vacío).
 */
export function clipWellToRoom(poly: Point[], well: { minX: number; minY: number; maxX: number; maxY: number }, inset = 0.002): Point[] | null {
  // Sutherland–Hodgman: el rectángulo del hueco recortado por el ambiente (convexo)
  const area = poly.reduce((s, p, i) => {
    const q = poly[(i + 1) % poly.length]!
    return s + p.x * q.y - q.x * p.y
  }, 0)
  const ccw = area > 0
  let out: Point[] = [
    { x: well.minX, y: well.minY },
    { x: well.maxX, y: well.minY },
    { x: well.maxX, y: well.maxY },
    { x: well.minX, y: well.maxY },
  ]
  for (let i = 0; i < poly.length && out.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    // distancia con signo hacia adentro del ambiente, menos el margen
    const side = (p: Point) => ((ccw ? 1 : -1) * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x))) / len - inset
    const next: Point[] = []
    for (let j = 0; j < out.length; j++) {
      const p = out[j]!
      const q = out[(j + 1) % out.length]!
      const sp = side(p)
      const sq = side(q)
      if (sp >= 0) next.push(p)
      if (sp >= 0 !== sq >= 0) {
        const k = sp / (sp - sq)
        next.push({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k })
      }
    }
    out = next
  }
  if (out.length < 3) return null
  const a2 = Math.abs(out.reduce((s, p, i) => s + p.x * out[(i + 1) % out.length]!.y - out[(i + 1) % out.length]!.x * p.y, 0)) / 2
  return a2 > 0.01 ? out : null
}

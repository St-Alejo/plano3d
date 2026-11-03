/**
 * Navegación de la simulación: una rejilla por piso (celdas de CELL m donde cabe una persona
 * parada en el piso del nivel) unida entre pisos por la ruta de la escalera. `findPath` busca
 * con A* y alisa el camino; los tramos de escalera se recorren punto por punto.
 *
 * Las puertas cuentan como abiertas (las personas las abren al llegar) y los muebles altos
 * como obstáculo. Geometría pura: se prueba en Vitest.
 */
import type { BuildingModel, Point } from '@/api/types'
import { resolveCollision, type Obstacle } from '../collision'
import { wallDirection } from '../model'
import { buildWalkWorld, groundAt, inRect, stairRoute, type WalkWorld } from '../walkPhysics'

export const CELL = 0.1
/** radio de una persona de la simulación (más delgada que quien recorre: pasa puertas de 0,52 m) */
export const AGENT_RADIUS = 0.2
const HEAD = 1.75

export interface LevelGrid {
  levelId: string
  elevation: number
  minX: number
  minY: number
  cols: number
  rows: number
  free: Uint8Array
}

/** Puente entre dos pisos: entrada abajo, salida arriba y los puntos de la escalera. */
export interface StairLink {
  lower: string
  upper: string
  route: Point[] // de abajo hacia arriba, incluye los extremos
}

export interface NavGrid {
  world: WalkWorld
  levels: LevelGrid[]
  links: StairLink[]
}

export interface Waypoint {
  x: number
  z: number
  levelId: string
  /** punto de la escalera: se sigue sin exigir el nivel */
  stair?: boolean
  /** puerta que se cruza al llegar a este punto (para abrirla antes) */
  door?: string
}

export interface NavPoint {
  x: number
  z: number
  levelId: string
}

function cellFree(world: WalkWorld, elevation: number, obstacles: ReturnType<typeof levelObstacles>, x: number, z: number): boolean {
  if (Math.abs(groundAt(world, x, z, elevation) - elevation) > 0.03) return false
  // bajo un peldaño que no deja pasar la cabeza
  if (world.steps.some((s) => s.top > elevation + 0.24 && s.under < elevation + HEAD && inRect(s.rect, x, z, AGENT_RADIUS))) return false
  const p = resolveCollision({ x, y: z }, obstacles, AGENT_RADIUS, 1)
  return Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - z) < 1e-6
}

function levelObstacles(world: WalkWorld, levelId: string) {
  return world.levels.find((l) => l.id === levelId)?.obstacles ?? []
}

export function buildNavGrid(model: BuildingModel, opts: { furniture?: boolean } = {}): NavGrid {
  const world = buildWalkWorld(model, opts)
  const levels: LevelGrid[] = []
  for (const lv of world.levels) {
    const b = lv.bounds
    if (!b) continue
    const minX = b.minX - CELL
    const minY = b.minY - CELL
    const cols = Math.ceil((b.maxX - b.minX) / CELL) + 3
    const rows = Math.ceil((b.maxY - b.minY) / CELL) + 3
    const free = new Uint8Array(cols * rows)
    const obstacles = levelObstacles(world, lv.id)
    // solo dentro de algún ambiente: afuera de la casa (o en un patio sin dibujar) no se pasea
    // el vano de una puerta queda en el grueso del muro, fuera de los dos ambientes
    // (también los vanos sin hoja, que la física no cuenta como puerta)
    const passages = doorwaysOf(model, lv.id)
    const inside = (x: number, z: number) => lv.floors.some((poly) => pointIn(poly, x, z)) || passages.some((d) => inRect(d, x, z, 0.12))
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = minX + (c + 0.5) * CELL
        const z = minY + (r + 0.5) * CELL
        if (inside(x, z) && cellFree(world, lv.elevation, obstacles, x, z)) free[r * cols + c] = 1
      }
    levels.push({ levelId: lv.id, elevation: lv.elevation, minX, minY, cols, rows, free })
  }
  const links: StairLink[] = []
  for (let i = 0; i + 1 < world.levels.length; i++) {
    const lower = world.levels[i]!
    const upper = world.levels[i + 1]!
    const route = stairRoute(model, lower.id, 1)
    if (route) links.push({ lower: lower.id, upper: upper.id, route })
  }
  return { world, levels, links }
}

/** Todos los vanos de puerta de un piso como rectángulos en el eje del muro. */
function doorwaysOf(model: BuildingModel, levelId: string): Obstacle[] {
  const lv = model.levels.find((l) => l.id === levelId)
  const out: Obstacle[] = []
  for (const w of lv?.walls ?? []) {
    if (w.bulge) continue
    const d = wallDirection(w)
    for (const o of w.openings) {
      if (o.kind !== 'door') continue
      const mid = o.offset + o.width / 2
      out.push({ cx: w.start.x + d.x * mid, cy: w.start.y + d.y * mid, halfLen: o.width / 2, halfThick: w.thickness / 2, cos: d.x, sin: d.y })
    }
  }
  return out
}

function pointIn(poly: Point[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

// ----------------------------------------------------------------------------- consultas

const gridOf = (nav: NavGrid, levelId: string) => nav.levels.find((g) => g.levelId === levelId)

function cellAt(g: LevelGrid, x: number, z: number): [number, number] {
  return [Math.floor((x - g.minX) / CELL), Math.floor((z - g.minY) / CELL)]
}

function isFree(g: LevelGrid, c: number, r: number): boolean {
  return c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.free[r * g.cols + c] === 1
}

const centerOf = (g: LevelGrid, c: number, r: number): Point => ({ x: g.minX + (c + 0.5) * CELL, y: g.minY + (r + 0.5) * CELL })

/** ¿Cabe una persona parada en (x, z) de ese piso? */
export function walkable(nav: NavGrid, p: NavPoint): boolean {
  const g = gridOf(nav, p.levelId)
  if (!g) return false
  const [c, r] = cellAt(g, p.x, p.z)
  return isFree(g, c, r)
}

/** La celda libre más cercana (hasta `maxDist`), o null. */
export function nearestWalkable(nav: NavGrid, p: NavPoint, maxDist = 1.2): NavPoint | null {
  const g = gridOf(nav, p.levelId)
  if (!g) return null
  const [c0, r0] = cellAt(g, p.x, p.z)
  const reach = Math.ceil(maxDist / CELL)
  let best: NavPoint | null = null
  let bestD = Infinity
  for (let dr = -reach; dr <= reach; dr++)
    for (let dc = -reach; dc <= reach; dc++) {
      if (!isFree(g, c0 + dc, r0 + dr)) continue
      const q = centerOf(g, c0 + dc, r0 + dr)
      const d = Math.hypot(q.x - p.x, q.y - p.z)
      if (d < bestD && d <= maxDist) {
        bestD = d
        best = { x: q.x, z: q.y, levelId: p.levelId }
      }
    }
  return best
}

/** Todas las celdas libres de un piso (para elegir destinos al azar). */
export function freeCells(nav: NavGrid, levelId: string): Point[] {
  const g = gridOf(nav, levelId)
  if (!g) return []
  const out: Point[] = []
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) if (g.free[r * g.cols + c]) out.push(centerOf(g, c, r))
  return out
}

/** ¿Se ve (y se camina) en línea recta de a a b sin salir de celdas libres? */
function lineFree(g: LevelGrid, a: Point, b: Point): boolean {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (CELL * 0.5))
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n
    const [c, r] = cellAt(g, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
    if (!isFree(g, c, r)) return false
  }
  return true
}

class Heap {
  private items: { k: number; f: number }[] = []
  get size() {
    return this.items.length
  }
  push(k: number, f: number) {
    const a = this.items
    a.push({ k, f })
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p]!.f <= a[i]!.f) break
      ;[a[p], a[i]] = [a[i]!, a[p]!]
      i = p
    }
  }
  pop(): number {
    const a = this.items
    const top = a[0]!
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l]!.f < a[m]!.f) m = l
        if (r < a.length && a[r]!.f < a[m]!.f) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i]!, a[m]!]
        i = m
      }
    }
    return top.k
  }
}

/** Camino en celdas dentro de un piso (A*, 8 vecinos sin cortar esquinas). */
function gridPath(g: LevelGrid, from: Point, to: Point): Point[] | null {
  const [c0, r0] = cellAt(g, from.x, from.y)
  const [c1, r1] = cellAt(g, to.x, to.y)
  if (!isFree(g, c0, r0) || !isFree(g, c1, r1)) return null
  const start = r0 * g.cols + c0
  const goal = r1 * g.cols + c1
  const cost = new Float32Array(g.cols * g.rows).fill(Infinity)
  const prev = new Int32Array(g.cols * g.rows).fill(-1)
  const h = (k: number) => {
    const dc = Math.abs((k % g.cols) - c1)
    const dr = Math.abs(Math.floor(k / g.cols) - r1)
    return Math.max(dc, dr) + 0.414 * Math.min(dc, dr)
  }
  const open = new Heap()
  cost[start] = 0
  open.push(start, h(start))
  while (open.size) {
    const k = open.pop()
    if (k === goal) break
    const c = k % g.cols
    const r = Math.floor(k / g.cols)
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue
        const nc = c + dc
        const nr = r + dr
        if (!isFree(g, nc, nr)) continue
        if (dc && dr && (!isFree(g, c + dc, r) || !isFree(g, c, r + dr))) continue
        const nk = nr * g.cols + nc
        const nd = cost[k]! + (dc && dr ? 1.414 : 1)
        if (nd < cost[nk]!) {
          cost[nk] = nd
          prev[nk] = k
          open.push(nk, nd + h(nk))
        }
      }
  }
  if (cost[goal] === Infinity) return null
  const cells: Point[] = []
  for (let k = goal; k !== -1; k = prev[k]!) cells.push(centerOf(g, k % g.cols, Math.floor(k / g.cols)))
  cells.reverse()
  // alisado: de cada punto, el más lejano que se ve en línea recta
  const out: Point[] = [from]
  let i = 0
  while (i < cells.length - 1) {
    let j = cells.length - 1
    while (j > i + 1 && !lineFree(g, out[out.length - 1]!, cells[j]!)) j--
    out.push(cells[j]!)
    i = j
  }
  out.push(to)
  return out
}

/** Marca las puertas que cruza cada tramo (para abrirlas antes de llegar). */
function tagDoors(nav: NavGrid, levelId: string, pts: Point[]): Waypoint[] {
  const doors = nav.world.doors.filter((d) => d.levelId === levelId)
  const out: Waypoint[] = []
  pts.forEach((p, i) => {
    if (i > 0) {
      const a = pts[i - 1]!
      const n = Math.ceil(Math.hypot(p.x - a.x, p.y - a.y) / 0.05)
      for (const d of doors) {
        let hit = false
        for (let s = 0; s <= n && !hit; s++) {
          const t = n === 0 ? 0 : s / n
          hit = inRect(d.closed, a.x + (p.x - a.x) * t, a.y + (p.y - a.y) * t)
        }
        // se pasa por el centro del vano: entre los marcos con holgura
        if (hit) out.push({ x: d.center.x, z: d.center.y, levelId, door: d.openingId })
      }
    }
    out.push({ x: p.x, z: p.y, levelId })
  })
  return out
}

/** Camino entre dos puntos de la casa, en el mismo piso o en otro (por la escalera). */
export function findPath(nav: NavGrid, from: NavPoint, to: NavPoint): Waypoint[] | null {
  const order = nav.world.levels.map((l) => l.id)
  const ia = order.indexOf(from.levelId)
  const ib = order.indexOf(to.levelId)
  if (ia < 0 || ib < 0) return null
  const out: Waypoint[] = []
  let cur: NavPoint = from
  const step = ib > ia ? 1 : -1
  for (let i = ia; i !== ib; i += step) {
    const link = nav.links.find((l) => (step === 1 ? l.lower === order[i] : l.upper === order[i]))
    if (!link) return null
    const route = step === 1 ? link.route : [...link.route].reverse()
    const entry = nearestWalkable(nav, { x: route[0]!.x, z: route[0]!.y, levelId: cur.levelId })
    if (!entry) return null
    const leg = legPath(nav, cur, entry)
    if (!leg) return null
    out.push(...leg)
    const next = order[i + step]!
    for (const p of route.slice(1, -1)) out.push({ x: p.x, z: p.y, levelId: cur.levelId, stair: true })
    const end = route[route.length - 1]!
    const exit = nearestWalkable(nav, { x: end.x, z: end.y, levelId: next })
    if (!exit) return null
    out.push({ x: end.x, z: end.y, levelId: next, stair: true })
    cur = exit
  }
  const last = legPath(nav, cur, to)
  if (!last) return null
  out.push(...last)
  return out
}

function legPath(nav: NavGrid, a: NavPoint, b: NavPoint): Waypoint[] | null {
  const g = gridOf(nav, a.levelId)
  if (!g) return null
  const pts = gridPath(g, { x: a.x, y: a.z }, { x: b.x, y: b.z })
  return pts ? tagDoors(nav, a.levelId, pts) : null
}

/** Largo de un camino (m), para elegir destinos cercanos o ver si vale la pena. */
export function pathLength(path: Waypoint[]): number {
  let n = 0
  for (let i = 1; i < path.length; i++) n += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z)
  return n
}

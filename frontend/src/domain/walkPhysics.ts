/**
 * Física del modo "Recorrer": un controlador cinemático de personaje, sin motor externo.
 *
 * La persona es un círculo en planta (radio 0,25 m) con los pies a una altura `y`:
 * - camina chocando con muros, columnas, muebles altos y puertas CERRADAS del nivel
 *   en el que está (`resolveCollision`, círculo contra caja orientada);
 * - el piso bajo sus pies es el más alto que puede pisar: piso del nivel o tapa de un
 *   peldaño. Sube peldaños de hasta STEP_UP y cae con gravedad;
 * - el nivel actual cambia solo al subir o bajar la escalera.
 *
 * Todo es geometría pura (sin three.js): se prueba en Vitest y corre en el celular.
 */
import type { BuildingModel, Point, Wall } from '@/api/types'
import { resolveCollision, type Obstacle } from './collision'
import { curvedWallBoxes, stairLandings, stairSteps, stairWell, wallToBoxes, type Box } from './geometry'
import { wallDirection } from './model'

export const EYE_HEIGHT = 1.6
export const RADIUS = 0.25
/** peldaño más alto que se sube caminando (la contrahuella típica es 0,175 m) */
export const STEP_UP = 0.24
export const GRAVITY = 9.8
const BLOCKING_HEIGHT = 1.0
const FURNITURE_BLOCKS = 0.5

export interface StepSurface {
  levelId: string
  stairId: string
  /** altura absoluta de la tapa del peldaño */
  top: number
  /** rectángulo del peldaño en planta (mismo formato que un obstáculo) */
  rect: Obstacle
  /** rango de alturas del tramo completo (para saber qué pisos tapa la escalera) */
  bottom: number
  flightTop: number
  /** piso del nivel de la escalera: el peldaño es macizo desde ahí */
  floor: number
}

export interface DoorBody {
  openingId: string
  levelId: string
  wallId: string
  /** el vano cerrado como obstáculo (hoja en el eje del muro) */
  closed: Obstacle
  /** punto medio del vano en planta (para abrir al acercarse) */
  center: Point
}

export interface WalkLevel {
  id: string
  name: string
  elevation: number
  obstacles: Obstacle[]
  floors: Point[][]
  /** envolvente del nivel (piso de respaldo donde no hay ambiente cerrado, p. ej. pasillos) */
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null
  /** hueco de la escalera que llega desde abajo: ahí la losa no existe */
  hole: { minX: number; minY: number; maxX: number; maxY: number } | null
}

export interface WalkWorld {
  levels: WalkLevel[] // de abajo hacia arriba
  steps: StepSurface[]
  doors: DoorBody[]
}

export interface CharacterState {
  x: number
  z: number
  /** altura de los pies */
  y: number
  vy: number
  levelId: string
}

// ----------------------------------------------------------------------------- mundo

function boxToObstacle(b: Pick<Box, 'center' | 'size' | 'rotationY'>): Obstacle {
  const angle = -b.rotationY
  return { cx: b.center[0], cy: b.center[2], halfLen: b.size[0] / 2, halfThick: b.size[2] / 2, cos: Math.cos(angle), sin: Math.sin(angle) }
}

function rectObstacle(cx: number, cy: number, w: number, d: number, rotation: number): Obstacle {
  return { cx, cy, halfLen: w / 2, halfThick: d / 2, cos: Math.cos(rotation), sin: Math.sin(rotation) }
}

function wallObstacles(w: Wall): Obstacle[] {
  const boxes = w.bulge ? curvedWallBoxes(w) : wallToBoxes(w)
  return boxes.filter((b) => b.center[1] - b.size[1] / 2 < BLOCKING_HEIGHT).map(boxToObstacle)
}

/** Vano de una puerta como obstáculo: bloquea mientras está cerrada. */
function doorObstacle(w: Wall, offset: number, width: number): { obstacle: Obstacle; center: Point } {
  const d = wallDirection(w)
  const mid = offset + width / 2
  const center = { x: w.start.x + d.x * mid, y: w.start.y + d.y * mid }
  return { obstacle: rectObstacle(center.x, center.y, width, w.thickness, Math.atan2(d.y, d.x)), center }
}

export function buildWalkWorld(model: BuildingModel): WalkWorld {
  const levels = [...model.levels].sort((a, b) => a.elevation - b.elevation)
  const steps: StepSurface[] = []
  const doors: DoorBody[] = []
  const out: WalkLevel[] = levels.map((lv) => {
    const obstacles: Obstacle[] = lv.walls.flatMap(wallObstacles)
    for (const c of lv.columns ?? []) obstacles.push(rectObstacle(c.center.x, c.center.y, c.width, c.round ? c.width : c.depth, c.rotation ?? 0))
    for (const f of lv.furniture ?? []) {
      if ((f.height ?? 0) > FURNITURE_BLOCKS) obstacles.push(rectObstacle(f.position.x, f.position.y, f.width, f.depth, f.rotation ?? 0))
    }
    for (const w of lv.walls) {
      if (w.bulge) continue
      for (const o of w.openings) {
        if (o.kind !== 'door' || o.operation === 'none') continue
        const { obstacle, center } = doorObstacle(w, o.offset, o.width)
        doors.push({ openingId: o.id, levelId: lv.id, wallId: w.id, closed: obstacle, center })
      }
    }
    for (const s of lv.stairs ?? []) {
      const boxes = stairSteps(s)
      const base = lv.elevation + (s.base ?? 0)
      const flightTop = base + s.riser * s.steps
      boxes.forEach((b, i) =>
        steps.push({ levelId: lv.id, stairId: s.id, top: base + s.riser * (i + 1), rect: boxToObstacle(b), bottom: base, flightTop, floor: lv.elevation }),
      )
    }
    for (const l of stairLandings(lv.stairs ?? [])) {
      const top = lv.elevation + l.top
      steps.push({ levelId: lv.id, stairId: 'descanso', top, rect: boxToObstacle(l.box), bottom: top, flightTop: top, floor: lv.elevation })
    }
    const xs = lv.walls.flatMap((w) => [w.start.x, w.end.x])
    const ys = lv.walls.flatMap((w) => [w.start.y, w.end.y])
    const bounds = xs.length ? { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } : null
    return { id: lv.id, name: lv.name, elevation: lv.elevation, obstacles, floors: lv.rooms.map((r) => r.polygon), bounds, hole: null }
  })
  // el hueco de cada losa es la escalera del nivel de abajo
  out.forEach((lv, i) => {
    if (i > 0) lv.hole = stairWell(levels[i - 1]!.stairs ?? [])
  })
  return { levels: out, steps, doors }
}

// ----------------------------------------------------------------------------- consultas

function inRect(o: Obstacle, x: number, y: number, margin = 0): boolean {
  const dx = x - o.cx
  const dy = y - o.cy
  const lx = dx * o.cos + dy * o.sin
  const ly = -dx * o.sin + dy * o.cos
  return Math.abs(lx) <= o.halfLen + margin && Math.abs(ly) <= o.halfThick + margin
}

function inPolygon(p: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Nivel en el que está alguien con los pies a la altura `y` (el más alto que ya alcanzó). */
export function levelAt(world: WalkWorld, y: number): WalkLevel {
  let current = world.levels[0]!
  for (const lv of world.levels) if (lv.elevation <= y + 0.3) current = lv
  return current
}

/**
 * Altura del piso que se puede pisar en (x, z) teniendo los pies en `feet`: la superficie
 * más alta que no supera `feet + STEP_UP`. Sobre el hueco de una escalera no cuenta el piso
 * de los niveles que la escalera atraviesa (si no, no se podría bajar por ella).
 */
export function groundAt(world: WalkWorld, x: number, z: number, feet: number): number {
  const reach = feet + STEP_UP
  const p = { x, y: z }
  let best = -Infinity
  // tramos de escalera bajo este punto: tapan los pisos entre su arranque y su llegada
  const overStairs = world.steps.filter((s) => inRect(s.rect, x, z, 0.02))
  const covered = (elev: number) => overStairs.some((s) => elev > s.bottom + 1e-6 && elev <= s.flightTop + 0.05)
  world.levels.forEach((lv, i) => {
    if (lv.elevation > reach || covered(lv.elevation)) return
    const lowest = i === 0
    const b = lv.bounds
    const onFloor =
      lowest ||
      lv.floors.some((poly) => inPolygon(p, poly)) ||
      (b !== null && x >= b.minX && x <= b.maxX && z >= b.minY && z <= b.maxY && !(lv.hole && x >= lv.hole.minX && x <= lv.hole.maxX && z >= lv.hole.minY && z <= lv.hole.maxY))
    if (onFloor) best = Math.max(best, lv.elevation)
  })
  for (const s of overStairs) if (s.top <= reach) best = Math.max(best, s.top)
  return best === -Infinity ? (world.levels[0]?.elevation ?? 0) : best
}

/** Obstáculos activos para alguien en el nivel `levelId` (puertas cerradas incluidas). */
export function obstaclesFor(world: WalkWorld, levelId: string, isOpen: (openingId: string) => boolean): Obstacle[] {
  const lv = world.levels.find((l) => l.id === levelId)
  const doors = world.doors.filter((d) => d.levelId === levelId && !isOpen(d.openingId)).map((d) => d.closed)
  return [...(lv?.obstacles ?? []), ...doors]
}

/** Lugar donde aparecer en un punto del plano de un nivel: sobre su piso. */
export function spawnAt(world: WalkWorld, at: Point, levelId?: string): CharacterState {
  const lv = world.levels.find((l) => l.id === levelId) ?? world.levels[0]
  const elevation = lv?.elevation ?? 0
  const y = groundAt(world, at.x, at.y, elevation)
  return { x: at.x, z: at.y, y, vy: 0, levelId: levelAt(world, y).id }
}

// ----------------------------------------------------------------------------- paso de simulación

/**
 * Avanza la simulación `dt` segundos con un desplazamiento horizontal deseado (m).
 * Un peldaño demasiado alto frena como una pared (se intenta deslizar por cada eje).
 */
export function stepCharacter(
  state: CharacterState,
  move: { dx: number; dz: number },
  dt: number,
  world: WalkWorld,
  isOpen: (openingId: string) => boolean = () => false,
): CharacterState {
  const t = Math.min(dt, 0.1)
  let { x, z, y, vy } = state
  const obstacles = obstaclesFor(world, state.levelId, isOpen)
  const tryMove = (nx: number, nz: number): boolean => {
    const p = resolveCollision({ x: nx, y: nz }, obstacles, RADIUS)
    const g = groundAt(world, p.x, p.y, y)
    // la tapa de un peldaño alto delante bloquea aunque el piso actual siga debajo
    // (los peldaños son macizos desde el piso de su nivel: solo cuentan si ese piso no está sobre la cabeza)
    const tooHigh = world.steps.some((s) => s.top > y + STEP_UP && s.floor <= y + EYE_HEIGHT && inRect(s.rect, p.x, p.y, RADIUS * 0.6))
    if (tooHigh || g > y + STEP_UP) return false
    x = p.x
    z = p.y
    return true
  }
  // en tramos de máximo 10 cm: un paso largo (cuadro lento) no atraviesa un muro delgado
  const n = Math.max(1, Math.ceil(Math.hypot(move.dx, move.dz) / 0.1))
  const sx = move.dx / n
  const sz = move.dz / n
  for (let i = 0; i < n && (sx !== 0 || sz !== 0); i++) {
    if (!tryMove(x + sx, z + sz)) {
      if (!tryMove(x + sx, z)) tryMove(x, z + sz)
    }
  }
  // vertical: subir o bajar peldaños con suavidad; caídas mayores con gravedad
  const ground = groundAt(world, x, z, y)
  if (ground > y) {
    y = Math.min(ground, y + Math.max(ground - y, 0.02) * Math.min(1, t * 14) + 0.002)
    vy = 0
  } else if (vy === 0 && y - ground <= STEP_UP) {
    y = Math.max(ground, y - Math.max(y - ground, 0.02) * Math.min(1, t * 14) - 0.002)
  } else {
    vy -= GRAVITY * t
    y += vy * t
    if (y <= ground) {
      y = ground
      vy = 0
    }
  }
  return { x, z, y, vy, levelId: levelAt(world, y).id }
}

/** Puerta más cercana a un punto (para abrir al acercarse), si está a menos de `maxDist`. */
export function nearestDoor(world: WalkWorld, levelId: string, at: Point, maxDist: number): DoorBody | null {
  let best: DoorBody | null = null
  let bestD = maxDist
  for (const d of world.doors) {
    if (d.levelId !== levelId) continue
    const dist = Math.hypot(d.center.x - at.x, d.center.y - at.y)
    if (dist < bestD) {
      best = d
      bestD = dist
    }
  }
  return best
}

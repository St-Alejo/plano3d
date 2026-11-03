/**
 * Personas de la simulación ("a lo Sims"): cada una elige un lugar de la casa (la cama, el
 * sofá, la cocina, un ambiente cualquiera, en cualquier piso), va caminando por el camino de
 * `findPath` con la misma física del recorrido (sube la escalera peldaño a peldaño), abre las
 * puertas al llegar a ellas, esquiva a las demás y a quien recorre, y se queda un rato.
 *
 * Todo es determinista con la semilla del `rng`: se prueba en Vitest sin three.js.
 */
import type { BuildingModel, Furniture, Point } from '@/api/types'
import type { Obstacle } from '../collision'
import { spawnAt, stepCharacter, type CharacterState } from '../walkPhysics'
import { AGENT_RADIUS, findPath, nearestWalkable, type NavGrid, type NavPoint, type Waypoint } from './navGrid'
import type { Rng } from './rng'

export type Activity = 'stand' | 'sit' | 'lie' | 'work'

/** Un lugar al que ir: dónde pararse y qué hacer ahí. */
export interface Spot {
  label: string
  at: NavPoint
  activity: Activity
  /** hacia dónde mirar al llegar (radianes en planta, 0 = +x) */
  yaw: number
  /** dónde queda el cuerpo al sentarse o acostarse (sobre el mueble), con la altura del asiento */
  anchor?: { x: number; z: number; y: number; yaw: number }
}

export interface Agent {
  id: number
  body: CharacterState
  yaw: number
  /** rapidez actual (m/s) para animar el paso */
  speed: number
  phase: 'walk' | 'stay' | 'wait'
  path: Waypoint[]
  index: number
  spot: Spot | null
  timer: number
  goals: number
  /** para detectar que se trabó */
  check: { x: number; z: number; t: number }
  stuck: number
}

/** Abre las puertas y dice si ya dejan pasar (la escena real o un simulacro en las pruebas). */
export interface DoorPort {
  open: (id: string) => void
  passable: (id: string) => boolean
}

/** Alguien más en la casa a quien esquivar (otra persona o quien recorre). */
export interface Body {
  x: number
  z: number
  levelId: string
  /** altura de los pies (si se conoce): en un tramo queda entre los dos pisos */
  y?: number
}

export const WALK_SPEED = 1.1
const STAIR_SPEED = 0.75
const BODY_HALF = 0.17
const LOOK_AHEAD = 1.1

// ----------------------------------------------------------------------------- lugares

const ACTIVITY: { test: RegExp; activity: Activity; label: string; seat?: number }[] = [
  { test: /^cama/, activity: 'lie', label: 'la cama', seat: 0.58 },
  { test: /^(sofa|sillon)/, activity: 'sit', label: 'el sofá', seat: 0.45 },
  { test: /^comedor/, activity: 'sit', label: 'el comedor', seat: 0.47 },
  { test: /^(silla|escritorio)/, activity: 'sit', label: 'el escritorio', seat: 0.47 },
  { test: /^(cocina|nevera)/, activity: 'work', label: 'la cocina' },
  { test: /^(lavamanos|lavadora)/, activity: 'work', label: 'el lavamanos' },
  { test: /^mueble_tv/, activity: 'stand', label: 'la televisión' },
]

const front = (f: Furniture): Point => ({ x: -Math.sin(f.rotation ?? 0), y: Math.cos(f.rotation ?? 0) })
const side = (f: Furniture): Point => ({ x: Math.cos(f.rotation ?? 0), y: Math.sin(f.rotation ?? 0) })

function furnitureSpot(nav: NavGrid, f: Furniture, levelId: string, elevation: number): Spot | null {
  const rule = ACTIVITY.find((a) => a.test.test(f.catalog_id))
  if (!rule) return null
  const fr = front(f)
  const sd = side(f)
  const c = f.position
  // por delante del mueble; si no se puede llegar ahí, por un costado o por detrás
  const tries: Point[] = [
    { x: c.x + fr.x * (f.depth / 2 + 0.35), y: c.y + fr.y * (f.depth / 2 + 0.35) },
    { x: c.x + sd.x * (f.width / 2 + 0.35), y: c.y + sd.y * (f.width / 2 + 0.35) },
    { x: c.x - sd.x * (f.width / 2 + 0.35), y: c.y - sd.y * (f.width / 2 + 0.35) },
    { x: c.x - fr.x * (f.depth / 2 + 0.35), y: c.y - fr.y * (f.depth / 2 + 0.35) },
  ]
  for (const t of tries) {
    const at = nearestWalkable(nav, { x: t.x, z: t.y, levelId }, 0.45)
    if (!at) continue
    const yaw = Math.atan2(c.y - at.z, c.x - at.x)
    const faceOut = Math.atan2(fr.y, fr.x)
    let anchor: Spot['anchor']
    if (rule.activity === 'lie') anchor = { x: c.x + fr.x * 0.05, z: c.y + fr.y * 0.05, y: elevation + rule.seat!, yaw: faceOut }
    else if (rule.activity === 'sit' && /^comedor/.test(f.catalog_id)) anchor = { x: at.x - Math.cos(yaw) * 0.12, z: at.z - Math.sin(yaw) * 0.12, y: elevation + rule.seat!, yaw }
    else if (rule.activity === 'sit') anchor = { x: c.x + fr.x * 0.12, z: c.y + fr.y * 0.12, y: elevation + rule.seat!, yaw: faceOut }
    return { label: rule.label, at, activity: rule.activity, yaw, anchor }
  }
  return null
}

/** Los lugares de la casa: los muebles con actividad y el centro de cada ambiente. */
export function spotsOf(model: BuildingModel, nav: NavGrid): Spot[] {
  const out: Spot[] = []
  for (const lv of model.levels) {
    for (const f of lv.furniture ?? []) {
      const s = furnitureSpot(nav, f, lv.id, lv.elevation)
      if (s) out.push(s)
    }
    for (const r of lv.rooms) {
      const c = r.centroid ?? r.polygon[0]
      if (!c) continue
      const at = nearestWalkable(nav, { x: c.x, z: c.y, levelId: lv.id }, 1.2)
      if (at) out.push({ label: r.label ?? 'un ambiente', at, activity: 'stand', yaw: 0 })
    }
  }
  return out
}

// ----------------------------------------------------------------------------- agentes

export function spawnAgents(nav: NavGrid, spots: Spot[], count: number, rng: Rng): Agent[] {
  const agents: Agent[] = []
  for (let i = 0; i < count && spots.length; i++) {
    // nadie aparece encima de otro
    let spot = spots[Math.floor(rng() * spots.length)]!
    for (let k = 0; k < 8 && agents.some((a) => a.body.levelId === spot.at.levelId && Math.hypot(a.body.x - spot.at.x, a.body.z - spot.at.z) < 0.6); k++)
      spot = spots[Math.floor(rng() * spots.length)]!
    const body = spawnAt(nav.world, { x: spot.at.x, y: spot.at.z }, spot.at.levelId)
    agents.push({
      id: i,
      body,
      yaw: rng() * Math.PI * 2,
      speed: 0,
      phase: 'stay',
      path: [],
      index: 0,
      spot: null,
      timer: 0.5 + rng() * 3,
      goals: 0,
      check: { x: body.x, z: body.z, t: 0 },
      stuck: 0,
    })
  }
  return agents
}

const STAY: Record<Activity, [number, number]> = { stand: [3, 7], sit: [8, 16], lie: [10, 20], work: [6, 12] }

/** Elige un lugar nuevo al que se pueda llegar desde donde está. */
function planNext(a: Agent, nav: NavGrid, spots: Spot[], rng: Rng): boolean {
  const here = nearestWalkable(nav, { x: a.body.x, z: a.body.z, levelId: a.body.levelId }, 0.8)
  if (!here) return false
  for (let k = 0; k < 6; k++) {
    const spot = spots[Math.floor(rng() * spots.length)]
    if (!spot || spot === a.spot) continue
    const path = findPath(nav, here, spot.at)
    if (!path || path.length < 2) continue
    a.path = path
    a.index = 1
    a.spot = spot
    a.phase = 'walk'
    a.check = { x: a.body.x, z: a.body.z, t: 0 }
    a.stuck = 0
    return true
  }
  return false
}

/** Vuelve a buscar camino al mismo lugar (alguien se atravesó o la puerta tardó). */
function replan(a: Agent, nav: NavGrid): boolean {
  const here = nearestWalkable(nav, { x: a.body.x, z: a.body.z, levelId: a.body.levelId }, 0.8)
  const path = here && a.spot ? findPath(nav, here, a.spot.at) : null
  if (!path) return false
  a.path = path
  a.index = 1
  return true
}

const angleTo = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from))

function square(b: Body): Obstacle {
  return { cx: b.x, cy: b.z, halfLen: BODY_HALF, halfThick: BODY_HALF, cos: 1, sin: 0 }
}

export interface StepContext {
  nav: NavGrid
  spots: Spot[]
  doors: DoorPort
  rng: Rng
  /** las demás personas y quien recorre */
  others: Body[]
  /** obstáculos que se mueven (el carro), por piso */
  moving?: (levelId: string) => Obstacle[]
}

/** Avanza una persona `dt` segundos. */
export function stepAgent(a: Agent, dt: number, ctx: StepContext): void {
  a.check.t += dt
  if (a.phase === 'stay' || a.phase === 'wait') {
    a.speed = 0
    a.timer -= dt
    if (a.spot && a.phase === 'stay') a.yaw += angleTo(a.yaw, a.spot.yaw) * Math.min(1, dt * 4)
    if (a.timer > 0) return
    if (a.phase === 'wait' && a.spot && a.path.length && replan(a, ctx.nav)) {
      a.phase = 'walk'
      a.check = { x: a.body.x, z: a.body.z, t: 0 }
      return
    }
    if (!planNext(a, ctx.nav, ctx.spots, ctx.rng)) a.timer = 1 + ctx.rng() * 2
    return
  }

  const wp = a.path[a.index]
  if (!wp) return arrive(a, ctx.rng)
  const dx = wp.x - a.body.x
  const dz = wp.z - a.body.z
  const dist = Math.hypot(dx, dz)
  // abrir la puerta al acercarse; esperar si todavía no deja pasar
  if (wp.door) {
    if (dist < 1.4) ctx.doors.open(wp.door)
    if (dist < 0.55 && !ctx.doors.passable(wp.door)) {
      a.speed = 0
      a.check = { x: a.body.x, z: a.body.z, t: 0 }
      return
    }
  }
  // la escalera es de una persona de ancho: si alguien va por el tramo, se espera al pie (o arriba)
  if (wp.stair && !a.path[a.index - 1]?.stair && flightBusy(a, wp, ctx)) {
    a.speed = 0
    a.check = { x: a.body.x, z: a.body.z, t: 0 }
    return
  }
  if (dist < (wp.stair ? 0.14 : 0.18)) {
    a.index++
    if (a.index >= a.path.length) arrive(a, ctx.rng)
    return
  }
  const speed = wp.stair ? STAIR_SPEED : WALK_SPEED
  const fx = dx / dist
  const fz = dz / dist
  let ux = fx
  let uz = fz
  // esquivar: quien está adelante y cerca empuja hacia un lado (siempre a la derecha, como en
  // la calle: dos que se cruzan se apartan hacia lados opuestos y no se bloquean)
  const near = ctx.others.filter((o) => o.levelId === a.body.levelId && Math.hypot(o.x - a.body.x, o.z - a.body.z) < LOOK_AHEAD)
  for (const o of near) {
    const ox = o.x - a.body.x
    const oz = o.z - a.body.z
    const d = Math.hypot(ox, oz) || 1e-3
    const ahead = (ox * fx + oz * fz) / d
    if (ahead < 0.2) continue
    const w = (1 - d / LOOK_AHEAD) * ahead * 1.6
    ux += fz * w
    uz -= fx * w
  }
  const n = Math.hypot(ux, uz) || 1
  const step = Math.min(dist, speed * dt)
  const extra = [...near.map(square), ...(ctx.moving?.(a.body.levelId) ?? [])]
  const before = a.body
  a.body = stepCharacter(before, { dx: (ux / n) * step, dz: (uz / n) * step }, dt, ctx.nav.world, ctx.doors.passable, { radius: AGENT_RADIUS, extra })
  const moved = Math.hypot(a.body.x - before.x, a.body.z - before.z)
  a.speed = dt > 0 ? moved / dt : 0
  if (moved > 1e-4) a.yaw += angleTo(a.yaw, Math.atan2(a.body.z - before.z, a.body.x - before.x)) * Math.min(1, dt * 8)
  // trabado: si en 2 s no avanzó 15 cm, espera un momento y vuelve a buscar camino
  if (a.check.t > 2) {
    const progress = Math.hypot(a.body.x - a.check.x, a.body.z - a.check.z)
    a.check = { x: a.body.x, z: a.body.z, t: 0 }
    if (progress < 0.15) {
      a.stuck++
      a.phase = 'wait'
      a.timer = 0.4 + ctx.rng() * 1.2
      if (a.stuck > 3) {
        // mejor ir a otra parte
        a.path = []
        a.stuck = 0
      }
    }
  }
}

/** ¿Hay otra persona en medio del tramo de escalera al que `a` va a entrar? */
function flightBusy(a: Agent, wp: Waypoint, ctx: StepContext): boolean {
  const link = ctx.nav.links.find((l) => (l.lower === a.body.levelId || l.upper === a.body.levelId) && (l.lower === wp.levelId || l.upper === wp.levelId))
  if (!link) return false
  const [foot, top] = [link.route[0]!, link.route[link.route.length - 1]!]
  const elev = (id: string) => ctx.nav.world.levels.find((l) => l.id === id)?.elevation ?? 0
  const [lo, hi] = [elev(link.lower), elev(link.upper)]
  return ctx.others.some((o) => {
    if (o.levelId !== link.lower && o.levelId !== link.upper) return false
    // con la altura se sabe si está en el tramo (entre los dos pisos) y no parado en uno de ellos
    if (o.y !== undefined && (o.y < lo + 0.08 || o.y > hi - 0.08)) return false
    const p = { x: o.x, y: o.z }
    // en los extremos se está esperando turno, no en el tramo
    if (Math.hypot(p.x - foot.x, p.y - foot.y) < 0.45 || Math.hypot(p.x - top.x, p.y - top.y) < 0.45) return false
    return link.route.some((q, i) => i > 0 && segDist(p, link.route[i - 1]!, q) < 0.45)
  })
}

function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy || 1
  const k = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k))
}

function arrive(a: Agent, rng: Rng): void {
  a.phase = 'stay'
  a.goals++
  a.speed = 0
  const [lo, hi] = STAY[a.spot?.activity ?? 'stand']
  a.timer = lo + rng() * (hi - lo)
}

/** Pose para dibujar: dónde va el cuerpo y en qué postura (sentado/acostado sobre el mueble). */
export function agentPose(a: Agent): { x: number; z: number; y: number; yaw: number; pose: Activity | 'walk' } {
  if (a.phase === 'stay' && a.spot) {
    const an = a.spot.anchor
    if (an) return { x: an.x, z: an.z, y: an.y, yaw: an.yaw, pose: a.spot.activity }
    return { x: a.body.x, z: a.body.z, y: a.body.y, yaw: a.yaw, pose: a.spot.activity }
  }
  return { x: a.body.x, z: a.body.z, y: a.body.y, yaw: a.yaw, pose: a.speed > 0.05 ? 'walk' : 'stand' }
}

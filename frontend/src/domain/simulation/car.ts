/**
 * El carro de la simulación: llega por la calle, espera a que el portón termine de abrir,
 * entra y se estaciona en el parqueadero; el portón se cierra. Después de un rato el portón
 * vuelve a abrir, el carro sale en reversa, se va por la calle y el portón cierra. Repite.
 *
 * Movimiento cinemático sobre un recorrido fijo (rectas y una curva de Bézier), con la
 * velocidad que frena antes de cada parada. Coordenadas del plano (x, y = z de la escena).
 */
import type { Level, Point, Room, Wall } from '@/api/types'
import type { Obstacle } from '../collision'
import { leftNormal, outwardSign } from '../facadeGeometry'
import { wallDirection } from '../model'
import { inPolygon } from '../walkPhysics'
import type { Body, DoorPort } from './agents'
import type { Rng } from './rng'

export const CAR_LENGTH = 4.2
export const CAR_WIDTH = 1.8
export const WHEEL_RADIUS = 0.32
/** carril de la calle: distancia a la fachada */
const LANE = 7
const STREET_FAR = 30
const STREET_SPEED = 5
const YARD_SPEED = 1.3
const BRAKE = 2.2

export interface Gate {
  openingId: string
  center: Point
  /** a lo largo de la fachada y hacia la calle */
  along: Point
  out: Point
  /** dónde queda el centro del carro estacionado */
  park: Point
  garage: string
}

const isGate = (o: Wall['openings'][number]) => o.kind === 'door' && o.operation === 'folding' && o.width >= 1.8

const add = (a: Point, b: Point, k = 1): Point => ({ x: a.x + b.x * k, y: a.y + b.y * k })
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y

/** Los portones de garaje del primer piso con el parqueadero que tienen detrás. */
export function garageGates(ground: Level): Gate[] {
  const out: Gate[] = []
  for (const w of ground.walls) {
    if (w.kind !== 'exterior' || w.bulge) continue
    const d = wallDirection(w)
    const n = leftNormal(w)
    const s = outwardSign(w, ground)
    const o = { x: n.x * s, y: n.y * s }
    for (const g of w.openings.filter(isGate)) {
      const center = add(w.start, d, g.offset + g.width / 2)
      const room = ground.rooms.find((r: Room) => inPolygon(add(center, o, -1.2), r.polygon))
      if (!room) continue
      // tan adentro como dé el ambiente, sin pasar del fondo (deja 0,4 m de holgura)
      const depth = Math.max(...room.polygon.map((p) => dot({ x: p.x - center.x, y: p.y - center.y }, { x: -o.x, y: -o.y })))
      const inside = Math.min(Math.max(CAR_LENGTH / 2 + 0.5, depth / 2), depth - CAR_LENGTH / 2 - 0.4)
      out.push({ openingId: g.id, center, along: d, out: o, park: add(center, o, -inside), garage: room.label ?? 'Parqueadero' })
    }
  }
  return out
}

// ----------------------------------------------------------------------------- recorridos

interface Track {
  points: Point[]
  /** largo acumulado en cada punto */
  at: number[]
}

function track(points: Point[]): Track {
  const at = [0]
  for (let i = 1; i < points.length; i++) at.push(at[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y))
  return { points, at }
}

const length = (t: Track) => t.at[t.at.length - 1]!

function line(a: Point, b: Point, step = 0.25): Point[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }))
}

function bezier(a: Point, c: Point, b: Point, n = 24): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    const u = 1 - t
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y }
  })
}

function poseOn(t: Track, s: number): { p: Point; dir: Point } {
  const total = length(t)
  const v = Math.max(0, Math.min(total, s))
  let i = 1
  while (i < t.at.length - 1 && t.at[i]! < v) i++
  const a = t.points[i - 1]!
  const b = t.points[i]!
  const seg = t.at[i]! - t.at[i - 1]! || 1
  const k = (v - t.at[i - 1]!) / seg
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return { p: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, dir: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } }
}

export interface CarRoutes {
  /** de la calle al parqueadero; `wait` es dónde para a esperar el portón */
  enter: Track
  wait: number
  /** del parqueadero a la calle, en reversa */
  back: Track
  /** por la calle hasta perderse */
  leave: Track
}

export function carRoutes(g: Gate): CarRoutes {
  const lane = add(g.center, g.out, LANE)
  const far = add(lane, g.along, STREET_FAR)
  const turnIn = add(lane, g.along, 5.5)
  // parada con la trompa a 1,2 m del portón
  const front = add(g.center, g.out, CAR_LENGTH / 2 + 1.2)
  const head = [...line(far, turnIn).slice(0, -1), ...bezier(turnIn, lane, front)]
  const enter = track([...head, ...line(front, g.park).slice(1)])
  const back = track([...line(g.park, front), ...bezier(front, lane, turnIn).slice(1)])
  const leave = track(line(turnIn, add(lane, g.along, -STREET_FAR)))
  return { enter, wait: length(track(head)), back, leave }
}

// ----------------------------------------------------------------------------- estado

export type CarPhase = 'away' | 'arrive' | 'gate-in' | 'enter' | 'parked' | 'gate-out' | 'back' | 'leave'

export interface Car {
  id: number
  gate: Gate
  routes: CarRoutes
  phase: CarPhase
  s: number
  speed: number
  timer: number
  x: number
  z: number
  /** hacia dónde apunta la trompa (radianes en planta) */
  yaw: number
  /** giro de las ruedas (radianes) */
  wheel: number
  /** el portón ya se pidió cerrar en esta pasada */
  closed: boolean
}

export function createCar(id: number, gate: Gate, delay: number): Car {
  const routes = carRoutes(gate)
  const { p, dir } = poseOn(routes.enter, 0)
  return { id, gate, routes, phase: 'away', s: 0, speed: 0, timer: delay, x: p.x, z: p.y, yaw: Math.atan2(dir.y, dir.x), wheel: 0, closed: false }
}

/** Rectángulo del carro: estorba a las personas y a quien recorre (solo en el primer piso). */
export function carObstacle(c: Car): Obstacle | null {
  if (c.phase === 'away') return null
  return { cx: c.x, cy: c.z, halfLen: CAR_LENGTH / 2, halfThick: CAR_WIDTH / 2, cos: Math.cos(c.yaw), sin: Math.sin(c.yaw) }
}

/** Punto de la trompa (o de la cola, si va en reversa) */
export function carNose(c: Car, k = 1): Point {
  return { x: c.x + Math.cos(c.yaw) * (CAR_LENGTH / 2) * k, y: c.z + Math.sin(c.yaw) * (CAR_LENGTH / 2) * k }
}

/** ¿Hay alguien justo delante (en el sentido en que va)? Entonces frena y espera. */
function blocked(c: Car, bodies: Body[], reverse: boolean): boolean {
  const k = reverse ? -1 : 1
  const hx = Math.cos(c.yaw) * k
  const hz = Math.sin(c.yaw) * k
  return bodies.some((b) => {
    const dx = b.x - c.x
    const dz = b.z - c.z
    const ahead = dx * hx + dz * hz
    const lateral = Math.abs(-dx * hz + dz * hx)
    return ahead > CAR_LENGTH / 2 - 0.2 && ahead < CAR_LENGTH / 2 + 1.4 && lateral < CAR_WIDTH / 2 + 0.35
  })
}

function drive(c: Car, t: Track, dt: number, vmax: number, stopAt: number, reverse: boolean, bodies: Body[]): boolean {
  const remaining = stopAt - c.s
  const target = blocked(c, bodies, reverse) ? 0 : Math.min(vmax, Math.sqrt(2 * BRAKE * Math.max(0, remaining)) + 0.15)
  // acelera y frena con suavidad
  c.speed += Math.max(-BRAKE * 2 * dt, Math.min(BRAKE * dt, target - c.speed))
  c.speed = Math.max(0, c.speed)
  const ds = Math.min(remaining, c.speed * dt)
  c.s += ds
  c.wheel += (ds / WHEEL_RADIUS) * (reverse ? -1 : 1)
  const { p, dir } = poseOn(t, c.s)
  c.x = p.x
  c.z = p.y
  c.yaw = Math.atan2(dir.y, dir.x) + (reverse ? Math.PI : 0)
  return c.s >= stopAt - 1e-3
}

/** ¿El carro quedó del todo de un lado del muro del portón? (+ = calle, − = garaje) */
function sideOfGate(c: Car): number {
  const g = c.gate
  const ends = [carNose(c, 1), carNose(c, -1)].map((p) => dot({ x: p.x - g.center.x, y: p.y - g.center.y }, g.out))
  if (Math.min(...ends) > 0.3) return 1
  if (Math.max(...ends) < -0.3) return -1
  return 0
}

export interface CarContext {
  doors: DoorPort & { close: (id: string) => void }
  rng: Rng
  /** personas y quien recorre en el primer piso */
  bodies: Body[]
}

export function stepCar(c: Car, dt: number, ctx: CarContext): void {
  const gate = c.gate.openingId
  const r = c.routes
  switch (c.phase) {
    case 'away':
      c.timer -= dt
      if (c.timer <= 0) {
        c.phase = 'arrive'
        c.s = 0
        c.speed = STREET_SPEED
        c.closed = false
      }
      return
    case 'arrive':
      if (c.s > r.wait - 9) ctx.doors.open(gate)
      if (drive(c, r.enter, dt, STREET_SPEED, r.wait, false, ctx.bodies)) c.phase = 'gate-in'
      return
    case 'gate-in':
      ctx.doors.open(gate)
      if (ctx.doors.passable(gate)) c.phase = 'enter'
      return
    case 'enter':
      if (drive(c, r.enter, dt, YARD_SPEED, length(r.enter), false, ctx.bodies)) {
        c.phase = 'parked'
        c.timer = 20 + ctx.rng() * 15
      }
      if (!c.closed && sideOfGate(c) === -1) {
        ctx.doors.close(gate)
        c.closed = true
      }
      return
    case 'parked':
      c.speed = 0
      c.timer -= dt
      if (c.timer <= 0) {
        c.phase = 'gate-out'
        c.closed = false
      }
      return
    case 'gate-out':
      ctx.doors.open(gate)
      if (ctx.doors.passable(gate)) {
        c.phase = 'back'
        c.s = 0
      }
      return
    case 'back':
      if (drive(c, r.back, dt, YARD_SPEED, length(r.back), true, ctx.bodies)) {
        c.phase = 'leave'
        c.s = 0
      }
      if (!c.closed && sideOfGate(c) === 1) {
        ctx.doors.close(gate)
        c.closed = true
      }
      return
    case 'leave':
      if (drive(c, r.leave, dt, STREET_SPEED, length(r.leave), false, ctx.bodies)) {
        c.phase = 'away'
        c.timer = 10 + ctx.rng() * 12
      }
      return
  }
}

/** Que llegue ya (botón "Llamar al carro"). */
export function callCar(c: Car): void {
  if (c.phase === 'away') c.timer = 0
  else if (c.phase === 'parked') c.timer = 0
}

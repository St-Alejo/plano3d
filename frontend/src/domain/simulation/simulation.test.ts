import { describe, expect, it } from 'vitest'
import type { BuildingModel, Furniture } from '@/api/types'
import { resolveCollision } from '@/domain/collision'
import opc3 from '@/test/opc3.json'
import { obstaclesFor } from '../walkPhysics'
import { agentPose, spawnAgents, spotsOf, stepAgent, type Agent, type Body, type DoorPort } from './agents'
import { CAR_LENGTH, carNose, carObstacle, createCar, garageGates, stepCar } from './car'
import { advanceHour, clockLabel, isNight, sunAt } from './clock'
import { AGENT_RADIUS, buildNavGrid, findPath, nearestWalkable, walkable } from './navGrid'
import { mulberry32 } from './rng'

/** La casa Opción 3 con algunos muebles: una cama por alcoba y un sofá en cada sala. */
function furnished(): BuildingModel {
  const m = structuredClone(opc3) as unknown as BuildingModel
  for (const lv of m.levels) {
    const add: Furniture[] = []
    for (const r of lv.rooms) {
      const c = r.centroid!
      if (/ALCOBA/i.test(r.label ?? '')) add.push({ id: `cama_${r.id}`, catalog_id: 'cama_sencilla', position: { x: c.x, y: c.y }, width: 1, depth: 1.95, height: 1, rotation: 0 })
      if (/SALA/i.test(r.label ?? '')) add.push({ id: `sofa_${r.id}`, catalog_id: 'sofa_2', position: { x: c.x, y: c.y }, width: 1.5, depth: 0.9, height: 0.85, rotation: 0 })
    }
    lv.furniture = add
  }
  return m
}

const model = furnished()
const nav = buildNavGrid(model)
const levels = [...model.levels].sort((a, b) => a.elevation - b.elevation)
const [p1, p2, p3] = levels

type DoorSim = DoorPort & { close: (id: string) => void; step: (dt: number) => void; goal: Map<string, boolean> }

/** Puertas de mentira: abren y cierran en 0,45 s, como en la escena. */
function doorSim(): DoorSim {
  const progress = new Map<string, number>()
  const goal = new Map<string, boolean>()
  return {
    goal,
    open: (id) => goal.set(id, true),
    close: (id) => goal.set(id, false),
    passable: (id) => (progress.get(id) ?? 0) > 0.5,
    step: (dt) => {
      for (const [id, g] of goal) {
        const cur = progress.get(id) ?? 0
        progress.set(id, g ? Math.min(1, cur + dt / 0.45) : Math.max(0, cur - dt / 0.45))
      }
    },
  }
}

function roomPoint(levelId: string, label: RegExp) {
  const lv = model.levels.find((l) => l.id === levelId)!
  const r = lv.rooms.find((x) => label.test(x.label ?? ''))!
  return nearestWalkable(nav, { x: r.centroid!.x, z: r.centroid!.y, levelId: lv.id }, 1.5)!
}

const insideWall = (x: number, z: number, levelId: string, radius: number) => {
  const p = resolveCollision({ x, y: z }, obstaclesFor(nav.world, levelId, () => true), radius)
  return Math.hypot(p.x - x, p.y - z)
}

describe('navegación de la casa', () => {
  it('del parqueadero a la alcoba 3 del piso 3: por puertas y escaleras, sin atravesar muros', () => {
    const path = findPath(nav, roomPoint(p1!.id, /Parqueadero 1/), roomPoint(p3!.id, /ALCOBA 3/))!
    expect(path).not.toBeNull()
    expect(path.some((w) => w.stair)).toBe(true)
    expect(path.some((w) => w.door)).toBe(true)
    expect(path.at(-1)!.levelId).toBe(p3!.id)
    // cada tramo plano, muestreado cada 5 cm, pasa donde cabe una persona
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!
      const b = path[i]!
      if (a.stair || b.stair || a.levelId !== b.levelId) continue
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05))
      for (let k = 0; k <= n; k++) expect(insideWall(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n, a.levelId, AGENT_RADIUS * 0.9)).toBeLessThan(1e-6)
    }
  })

  it('el hueco de la escalera no es pisable en el piso de arriba', () => {
    const s = p1!.stairs![1]!
    expect(walkable(nav, { x: s.start.x, z: (s.start.y + s.end.y) / 2, levelId: p2!.id })).toBe(false)
  })

  it('hay lugares en los muebles (cama: acostarse, sofá: sentarse) y en cada ambiente', () => {
    const spots = spotsOf(model, nav)
    expect(spots.filter((s) => s.activity === 'lie').length).toBe(6)
    expect(spots.filter((s) => s.activity === 'sit').length).toBe(2)
    expect(spots.filter((s) => s.activity === 'stand').length).toBeGreaterThanOrEqual(18)
    const bed = spots.find((s) => s.activity === 'lie')!
    expect(bed.anchor!.y).toBeGreaterThan(model.levels.find((l) => l.id === bed.at.levelId)!.elevation + 0.4)
  })
})

/** Corre la simulación `seconds` segundos; devuelve la distancia mínima entre personas que caminan. */
function run(agents: Agent[], seconds: number, opts: { player?: Body; seed?: number; spots?: ReturnType<typeof spotsOf> } = {}) {
  const doors = doorSim()
  const rng = mulberry32(opts.seed ?? 7)
  const spots = opts.spots ?? spotsOf(model, nav)
  let minGap = Infinity
  let closestToPlayer = Infinity
  const visited = agents.map((a) => new Set([a.body.levelId]))
  const dt = 1 / 30
  for (let t = 0; t < seconds; t += dt) {
    doors.step(dt)
    agents.forEach((a, i) => {
      const others: Body[] = agents.filter((b) => b !== a).map((b) => ({ x: b.body.x, z: b.body.z, levelId: b.body.levelId, y: b.body.y }))
      if (opts.player) others.push(opts.player)
      stepAgent(a, dt, { nav, spots, doors, rng, others })
      visited[i]!.add(a.body.levelId)
      if (opts.player && a.body.levelId === opts.player.levelId) closestToPlayer = Math.min(closestToPlayer, Math.hypot(a.body.x - opts.player.x, a.body.z - opts.player.z))
    })
    for (let i = 0; i < agents.length; i++)
      for (let j = i + 1; j < agents.length; j++) {
        const a = agents[i]!
        const b = agents[j]!
        if (a.body.levelId === b.body.levelId && a.phase !== 'stay' && b.phase !== 'stay') minGap = Math.min(minGap, Math.hypot(a.body.x - b.body.x, a.body.z - b.body.z))
      }
  }
  return { minGap, visited, closestToPlayer }
}

describe('personas que se mueven solas', () => {
  it('en un pasillo angosto esperan en vez de atravesar a quien está parado', () => {
    const corridor = roomPoint(p2!.id, /Pasillo/)
    const player: Body = { x: corridor.x, z: corridor.z, levelId: p2!.id }
    const spots = spotsOf(model, nav).filter((s) => s.at.levelId === p2!.id && Math.hypot(s.at.x - player.x, s.at.z - player.z) > 0.8)
    const agents = spawnAgents(nav, spots, 3, mulberry32(3))
    const { closestToPlayer } = run(agents, 60, { player, spots, seed: 3 })
    expect(closestToPlayer).toBeGreaterThan(0.3)
  })

  it('6 personas en 3 minutos: van a varios lugares, cambian de piso y no atraviesan muros ni a otras', () => {
    const agents = spawnAgents(nav, spotsOf(model, nav), 6, mulberry32(42))
    const { minGap, visited } = run(agents, 180)
    for (const a of agents) {
      expect(a.goals).toBeGreaterThanOrEqual(3)
      expect(insideWall(a.body.x, a.body.z, a.body.levelId, AGENT_RADIUS * 0.8)).toBeLessThan(0.02)
      // con los pies en un piso de verdad, no dentro de una losa
      const lv = levels.find((l) => l.id === a.body.levelId)!
      expect(a.body.y).toBeGreaterThan(lv.elevation - 0.05)
      expect(a.body.y).toBeLessThan(lv.elevation + 2.4)
    }
    expect(visited.some((s) => s.size > 1)).toBe(true)
    expect(minGap).toBeGreaterThan(0.3)
  })

  it('alguien parado en la sala no detiene a nadie: lo rodean sin tocarlo', () => {
    const corridor = roomPoint(p2!.id, /SALA/)
    const player: Body = { x: corridor.x, z: corridor.z, levelId: p2!.id }
    const spots = spotsOf(model, nav).filter((s) => s.at.levelId === p2!.id && Math.hypot(s.at.x - player.x, s.at.z - player.z) > 0.8)
    const agents = spawnAgents(nav, spots, 3, mulberry32(3))
    const { closestToPlayer } = run(agents, 90, { player, spots, seed: 3 })
    expect(agents.every((a) => a.goals >= 3)).toBe(true)
    expect(closestToPlayer).toBeGreaterThan(0.3)
  })

  it('acostada en la cama, la pose queda sobre el mueble', () => {
    const bed = spotsOf(model, nav).find((s) => s.activity === 'lie')!
    const [a] = spawnAgents(nav, [bed], 1, mulberry32(1))
    a!.spot = bed
    a!.phase = 'stay'
    a!.timer = 5
    const pose = agentPose(a!)
    expect(pose.pose).toBe('lie')
    expect(pose.y).toBeCloseTo(bed.anchor!.y)
  })
})

describe('el carro entra al garaje', () => {
  const gates = garageGates(p1!)
  const depthOf = (g: (typeof gates)[number], p: { x: number; y: number }) => (p.x - g.center.x) * g.out.x + (p.y - g.center.y) * g.out.y

  it('cada portón tiene su parqueadero y un lugar para estacionar adentro', () => {
    expect(gates.length).toBe(2)
    for (const g of gates) {
      expect(g.garage).toMatch(/Parqueadero/)
      expect(walkable(nav, { x: g.park.x, z: g.park.y, levelId: p1!.id })).toBe(true)
    }
  })

  it('el portón abre antes de que pase, cierra con el carro adentro y vuelve a abrir para salir', () => {
    const g = gates[0]!
    const car = createCar(0, g, 0)
    const doors = doorSim()
    const rng = mulberry32(5)
    const log: string[] = []
    let crossedClosed = false
    let deepest = -Infinity
    for (let t = 0; t < 120; t += 1 / 30) {
      doors.step(1 / 30)
      stepCar(car, 1 / 30, { doors, rng, bodies: [] })
      if (log.at(-1) !== car.phase) log.push(car.phase)
      const ends = [depthOf(g, carNose(car)), depthOf(g, carNose(car, -1))]
      // ninguna parte del carro está en la línea del portón con la hoja cerrada
      if (Math.min(...ends) < 0 && Math.max(...ends) > 0 && !doors.passable(g.openingId)) crossedClosed = true
      if (car.phase === 'parked') {
        deepest = Math.max(deepest, ...ends)
        expect(doors.goal.get(g.openingId)).toBe(false)
      }
    }
    expect(crossedClosed).toBe(false)
    expect(deepest).toBeLessThan(0)
    expect(log).toEqual(expect.arrayContaining(['arrive', 'gate-in', 'enter', 'parked', 'gate-out', 'back', 'leave', 'away']))
    expect(doors.goal.get(g.openingId)).toBe(false)
  })

  it('frena si alguien se le atraviesa y no lo atropella', () => {
    const g = gates[0]!
    const car = createCar(0, g, 0)
    const doors = doorSim()
    const blocker: Body = { x: g.center.x + g.out.x * 0.8, z: g.center.y + g.out.y * 0.8, levelId: p1!.id }
    for (let t = 0; t < 40; t += 1 / 30) {
      doors.step(1 / 30)
      stepCar(car, 1 / 30, { doors, rng: mulberry32(5), bodies: [blocker] })
    }
    expect(car.phase).not.toBe('parked')
    const pushed = resolveCollision({ x: blocker.x, y: blocker.z }, [carObstacle(car)!], 0.2)
    expect(Math.hypot(pushed.x - blocker.x, pushed.y - blocker.z)).toBeLessThan(1e-6)
    expect(CAR_LENGTH).toBeGreaterThan(3)
  })
})

describe('día y noche', () => {
  it('a las 22 h es de noche, a mediodía el sol está alto y el reloj da la vuelta', () => {
    expect(isNight(22)).toBe(true)
    expect(isNight(12)).toBe(false)
    expect(sunAt(12).altitude).toBeGreaterThan(60)
    expect(advanceHour(23.9, 20 * 0.2)).toBeCloseTo(0.1)
    expect(clockLabel(7.5)).toBe('07:30')
  })
})

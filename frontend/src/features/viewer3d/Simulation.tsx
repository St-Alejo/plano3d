/**
 * La simulación dentro del lienzo: avanza personas, carros y reloj en cada cuadro, abre y
 * cierra las puertas de la escena (`useWalk.setDoor`) y mueve las mallas. Funciona en
 * Orbitar y en Recorrer; quien recorre cuenta como alguien a quien esquivar.
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { BuildingModel } from '@/api/types'
import type { Obstacle } from '@/domain/collision'
import { agentPose, spawnAgents, spotsOf, stepAgent, type Agent, type Body, type DoorPort } from '@/domain/simulation/agents'
import { callCar, carObstacle, createCar, garageGates, stepCar, type Car } from '@/domain/simulation/car'
import { advanceHour, isNight } from '@/domain/simulation/clock'
import { buildNavGrid } from '@/domain/simulation/navGrid'
import { mulberry32 } from '@/domain/simulation/rng'
import { doorPassable } from './doors'
import { createCarMesh, createPerson, disposeActors, poseCar, posePerson, type CarRig, type PersonRig } from './scene/actors'
import { setSimObstacles } from './simObstacles'
import { useSim } from './simStore'
import { useWalk } from './walkStore'

const BODY: Pick<Obstacle, 'halfLen' | 'halfThick' | 'cos' | 'sin'> = { halfLen: 0.17, halfThick: 0.17, cos: 1, sin: 0 }
/** segundos sin nadie cerca para cerrar una puerta que abrió la simulación */
const CLOSE_AFTER = 1.5

export function Simulation({ model, furniture, walking }: { model: BuildingModel; furniture: boolean; walking: boolean }) {
  const on = useSim((s) => s.on)
  const people = useSim((s) => s.people)
  const carOn = useSim((s) => s.car)
  const resetNonce = useSim((s) => s.resetNonce)
  const nav = useMemo(() => (on ? buildNavGrid(model, { furniture }) : null), [model, furniture, on])
  const spots = useMemo(() => (nav ? spotsOf(model, nav) : []), [model, nav])
  const ground = useMemo(() => [...model.levels].sort((a, b) => a.elevation - b.elevation)[0], [model])
  const group = useRef<THREE.Group>(null)
  const state = useRef<{ agents: Agent[]; rigs: PersonRig[]; cars: Car[]; carRigs: CarRig[]; opened: Map<string, number>; rng: () => number; call: number; tick: number; hour: number; shown: number } | null>(null)

  // arma (o rearma) a las personas y los carros
  useEffect(() => {
    const g = group.current
    if (!nav || !g) return
    const rng = mulberry32(model.project_id.length * 7919 + people)
    const agents = spawnAgents(nav, spots, people, rng)
    const rigs = agents.map((_, i) => createPerson(i))
    const gates = ground ? garageGates(ground) : []
    // un carro por portón, que llegan con unos segundos de diferencia
    const cars = gates.map((gate, i) => createCar(i, gate, 2 + i * 22))
    const carRigs = cars.map((_, i) => createCarMesh(i))
    for (const r of rigs) g.add(r.root)
    for (const r of carRigs) g.add(r.root)
    const hour = useSim.getState().hour
    state.current = { agents, rigs, cars, carRigs, opened: new Map(), rng, call: useSim.getState().callNonce, tick: 0, hour, shown: hour }
    return () => {
      for (const r of rigs) g.remove(r.root)
      for (const r of carRigs) g.remove(r.root)
      // las puertas que dejó abiertas la simulación se cierran
      const walk = useWalk.getState()
      for (const id of state.current?.opened.keys() ?? []) walk.setDoor(id, false)
      for (const c of cars) walk.setDoor(c.gate.openingId, false)
      state.current = null
      setSimObstacles([])
    }
  }, [nav, spots, people, ground, model.project_id, resetNonce])

  useEffect(() => () => disposeActors(), [])

  useFrame((_, rawDt) => {
    const s = state.current
    const sim = useSim.getState()
    if (!s || !nav || sim.paused) return
    const dt = Math.min(rawDt, 0.1)
    const walk = useWalk.getState()
    const now = performance.now() / 1000
    s.tick++

    // puertas: la simulación las abre al llegar y las cierra cuando ya no hay nadie cerca
    const doors: DoorPort & { close: (id: string) => void } = {
      open: (id) => {
        if (!walk.doors[id]) {
          walk.setDoor(id, true)
          s.opened.set(id, now)
        } else if (s.opened.has(id)) s.opened.set(id, now)
      },
      close: (id) => {
        walk.setDoor(id, false)
        s.opened.delete(id)
      },
      passable: doorPassable,
    }

    const hud = walk.hud
    const player: Body | null = walking && hud ? { x: hud.x, z: hud.z, levelId: hud.levelId, y: hud.y } : null
    const carBoxes = carOn ? s.cars.map(carObstacle).filter((o): o is Obstacle => o !== null) : []
    const groundId = ground?.id ?? ''

    if (sim.callNonce !== s.call) {
      s.call = sim.callNonce
      s.cars.forEach(callCar)
    }

    const bodies: Body[] = s.agents.map((a) => ({ x: a.body.x, z: a.body.z, levelId: a.body.levelId, y: a.body.y }))
    s.agents.forEach((a, i) => {
      const others = bodies.filter((_, j) => j !== i)
      if (player) others.push(player)
      stepAgent(a, dt, { nav, spots, doors, rng: s.rng, others, moving: (lv) => (lv === groundId ? carBoxes : []) })
      bodies[i] = { x: a.body.x, z: a.body.z, levelId: a.body.levelId }
    })
    if (carOn) {
      const onGround = bodies.filter((b) => b.levelId === groundId)
      if (player?.levelId === groundId) onGround.push(player)
      for (const c of s.cars) stepCar(c, dt, { doors, rng: s.rng, bodies: onGround })
    }

    // cerrar lo que quedó abierto sin nadie cerca (las del portón las maneja el carro)
    const gateIds = new Set(s.cars.map((c) => c.gate.openingId))
    for (const [id, since] of s.opened) {
      if (gateIds.has(id)) continue
      const d = nav.world.doors.find((x) => x.openingId === id)
      const near = d && [...bodies, ...(player ? [player] : [])].some((b) => b.levelId === d.levelId && Math.hypot(b.x - d.center.x, b.z - d.center.y) < 1.2)
      if (near) s.opened.set(id, now)
      else if (now - since > CLOSE_AFTER) {
        walk.setDoor(id, false)
        s.opened.delete(id)
      }
    }

    // obstáculos para quien recorre
    setSimObstacles([
      ...s.agents.map((a) => ({ levelId: a.body.levelId, obstacle: { ...BODY, cx: a.body.x, cy: a.body.z } })),
      ...carBoxes.map((obstacle) => ({ levelId: groundId, obstacle })),
    ])

    // reloj del día
    // (si la hora de la interfaz no es la última que se mostró, alguien movió el deslizador)
    if (sim.hour !== s.shown) s.hour = sim.hour
    if (sim.dayNight) s.hour = advanceHour(s.hour, dt, sim.speed)
    const hour = s.hour
    const night = sim.dayNight && isNight(hour)

    // mallas
    const hidden = new Set(sim.hidden)
    s.agents.forEach((a, i) => {
      const rig = s.rigs[i]!
      posePerson(rig, agentPose(a), a.speed, dt)
      rig.root.visible = !hidden.has(a.body.levelId)
    })
    s.cars.forEach((c, i) => {
      const rolling = c.speed > 0.05
      poseCar(s.carRigs[i]!, { x: c.x, z: c.z, yaw: c.yaw, wheel: c.wheel, visible: carOn && c.phase !== 'away' }, night || rolling, c.phase === 'gate-in' || c.phase === 'gate-out')
    })

    // a la interfaz, unas 5 veces por segundo
    if (s.tick % 12 === 0 || night !== sim.night) {
      s.shown = hour
      sim.setHour(hour, night)
      sim.setMarks({
        people: s.agents.map((a, i) => ({ id: a.id, x: a.body.x, z: a.body.z, levelId: a.body.levelId, color: s.rigs[i]!.color })),
        cars: s.cars.map((c) => ({ id: c.id, x: c.x, z: c.z, yaw: c.yaw, visible: carOn && c.phase !== 'away' })),
      })
    }
  })

  if (!on) return null
  return <group ref={group} name="simulation" />
}

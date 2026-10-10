/**
 * Modo "Recorrer" en primera persona, con física (dominio puro `walkPhysics`):
 * piso y gravedad, escaleras que se suben caminando, puertas que se abren y cierran.
 *
 * - Escritorio: clic para capturar el mouse, WASD / flechas, Shift corre, E interactúa,
 *   Q / Z cambia de piso.
 * - Táctil: joystick para caminar (al máximo corre), arrastrar con otro dedo para mirar,
 *   y el botón de acción de la interfaz (`WalkHud`).
 *
 * La interfaz y el lienzo se comunican por `useWalk` (órdenes y estado del HUD).
 */
import { PointerLockControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { BuildingModel, Point, Stair } from '@/api/types'
import { bestViewAngle } from '@/domain/collision'
import { pointAlong, wallDirection } from '@/domain/model'
import {
  buildWalkWorld,
  EYE_HEIGHT as EYE,
  nearestDoor,
  obstaclesFor,
  spawnAt,
  stepCharacter,
  type CharacterState,
  type WalkWorld,
} from '@/domain/walkPhysics'
import { doorPassable, kindOf } from './doors'
import { prefersReducedMotion } from './motion'
import { useWalk, type Focus } from './walkStore'

export const EYE_HEIGHT = EYE
const SPEED = 2.2 // m/s
const RUN = 1.8
const LOOK_SPEED = 0.005
const REACH = 2.4 // m: hasta dónde alcanza el "mirar y actuar"
const AUTO_DOOR = 1.3 // m: las puertas automáticas abren a esta distancia
// vectores de trabajo reutilizados en cada frame (sin crear basura para el GC)
const forward = new THREE.Vector3()
const right = new THREE.Vector3()
const ray = new THREE.Raycaster()

/** Entrada compartida entre el joystick (HTML) y el bucle de render. */
export interface WalkInput {
  x: number // -1..1 lateral
  y: number // -1..1 adelante
}

/** Punto de partida: en planta y (opcional) en qué nivel. */
export type WalkStart = Point & { levelId?: string }

const KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
}

const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement

function useKeyboard() {
  const pressed = useRef(new Set<string>())
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return
      pressed.current.add(e.code)
      const send = useWalk.getState().send
      if (e.code === 'KeyE') send({ type: 'act' })
      else if (e.code === 'KeyQ') send({ type: 'level', dir: 1 })
      else if (e.code === 'KeyZ') send({ type: 'level', dir: -1 })
    }
    const up = (e: KeyboardEvent) => pressed.current.delete(e.code)
    const blur = () => pressed.current.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
  return pressed
}

/** Recorrido automático (subir una escalera, asomarse a una ventana): puntos y mirada final. */
interface Autopilot {
  points: Point[]
  yaw?: number
  stuck: number
}

const yawToward = (dx: number, dz: number) => Math.atan2(-dx, -dz)

export function WalkControls({
  model,
  start,
  input,
  touch,
  root,
}: {
  model: BuildingModel
  start: WalkStart
  input: React.RefObject<WalkInput>
  touch: boolean
  /** escena construida (para "mirar y actuar" con un rayo) */
  root?: THREE.Object3D | null
}) {
  const { camera, gl } = useThree()
  const keys = useKeyboard()
  const world = useMemo<WalkWorld>(() => buildWalkWorld(model), [model])
  const stairs = useMemo(() => model.levels.flatMap((lv) => (lv.stairs ?? []).map((s) => ({ s, levelId: lv.id, elevation: lv.elevation }))), [model])
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))
  const body = useRef<CharacterState>(spawnAt(world, start, start.levelId))
  const auto = useRef<Autopilot | null>(null)
  const frame = useRef(0)
  const bob = useRef(0)
  const autoOpened = useRef(new Set<string>())
  const reduced = useMemo(() => prefersReducedMotion(), [])

  const setYaw = (yaw: number) => {
    const e = euler.current.setFromQuaternion(camera.quaternion)
    e.y = yaw
    camera.quaternion.setFromEuler(e)
  }

  const { x: sx, y: sy, levelId: sl } = start
  useEffect(() => {
    body.current = spawnAt(world, { x: sx, y: sy }, sl)
    auto.current = null
    const b = body.current
    camera.position.set(b.x, b.y + EYE, b.z)
    // se empieza mirando hacia donde hay más espacio libre, no contra un muro
    const a = bestViewAngle({ x: sx, y: sy }, obstaclesFor(world, b.levelId, () => true))
    euler.current.set(0, Math.atan2(-Math.cos(a), -Math.sin(a)), 0)
    camera.quaternion.setFromEuler(euler.current)
  }, [camera, sx, sy, sl, world])

  useEffect(() => () => useWalk.getState().setFocus(null), [])

  // mirar arrastrando el dedo (táctil): un solo dedo manda; el joystick es HTML aparte
  useEffect(() => {
    if (!touch) return
    const el = gl.domElement
    let active: { id: number; x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      if (!active) active = { id: e.pointerId, x: e.clientX, y: e.clientY }
    }
    const move = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.id) return
      const k = LOOK_SPEED * useWalk.getState().lookSensitivity
      const e2 = euler.current.setFromQuaternion(camera.quaternion)
      e2.y -= (e.clientX - active.x) * k
      e2.x = THREE.MathUtils.clamp(e2.x - (e.clientY - active.y) * k, -1.2, 1.2)
      camera.quaternion.setFromEuler(e2)
      active = { ...active, x: e.clientX, y: e.clientY }
      auto.current = null
    }
    const up = (e: PointerEvent) => {
      if (active?.id === e.pointerId) active = null
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [touch, gl, camera])

  /** Recorrido de una escalera: del pie a la llegada (o al revés si se está arriba). */
  const stairPath = (s: Stair, elevation: number): Autopilot => {
    const dx = s.end.x - s.start.x
    const dy = s.end.y - s.start.y
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    const top = elevation + (s.base ?? 0) + s.riser * s.steps
    const up = body.current.y < top - 0.5
    const foot = { x: s.start.x - ux * 0.45, y: s.start.y - uy * 0.45 }
    const head = { x: s.end.x + ux * 0.6, y: s.end.y + uy * 0.6 }
    return { points: up ? [foot, head] : [{ x: s.end.x + ux * 0.25, y: s.end.y + uy * 0.25 }, foot], stuck: 0 }
  }

  const act = (focus: Focus) => {
    if (!focus) return
    const st = useWalk.getState()
    if (focus.kind === 'door') st.toggleDoor(focus.id)
    else if (focus.kind === 'stair') {
      const found = stairs.find((x) => x.s.id === focus.id)
      if (found) auto.current = stairPath(found.s, found.elevation)
    } else if (focus.kind === 'window') {
      for (const lv of model.levels)
        for (const w of lv.walls) {
          const o = w.openings.find((x) => x.id === focus.id)
          if (!o) continue
          const c = pointAlong(w, o.offset + o.width / 2)
          const d = wallDirection(w)
          const n = { x: -d.y, y: d.x }
          const b = body.current
          const side = Math.sign((b.x - c.x) * n.x + (b.z - c.y) * n.y) || 1
          // se acerca hasta quedar frente al vidrio, del lado en que está, mirando hacia afuera
          auto.current = { points: [{ x: c.x + n.x * side * 0.55, y: c.y + n.y * side * 0.55 }], yaw: yawToward(-n.x * side, -n.y * side), stuck: 0 }
        }
    }
  }

  /** Cambio de piso: por la escalera que conecta los dos niveles o, si no hay, en el mismo punto. */
  const changeLevel = (dir: 1 | -1) => {
    const b = body.current
    const idx = world.levels.findIndex((l) => l.id === b.levelId)
    const target = world.levels[idx + dir]
    if (!target) return
    const cur = world.levels[idx]!
    const link = stairs.find((x) =>
      dir === 1 ? Math.abs(x.elevation - cur.elevation) < 0.05 : Math.abs(x.elevation - target.elevation) < 0.05,
    )
    if (link) {
      const s = link.s
      const len = Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y) || 1
      const ux = (s.end.x - s.start.x) / len
      const uy = (s.end.y - s.start.y) / len
      const at = dir === 1 ? { x: s.end.x + ux * 0.7, y: s.end.y + uy * 0.7 } : { x: s.start.x - ux * 0.7, y: s.start.y - uy * 0.7 }
      body.current = spawnAt(world, at, target.id)
      setYaw(dir === 1 ? yawToward(ux, uy) : yawToward(-ux, -uy))
    } else body.current = spawnAt(world, { x: b.x, y: b.z }, target.id)
    auto.current = null
  }

  useFrame(({ camera: cam }, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const st = useWalk.getState()
    for (const c of st.take()) {
      if (c.type === 'act') act(st.focus)
      else if (c.type === 'level') changeLevel(c.dir)
      else if (c.type === 'teleport') {
        body.current = spawnAt(world, { x: c.x, y: c.z }, c.levelId ?? body.current.levelId)
        auto.current = null
      }
    }

    // entrada: joystick + teclado
    let ax = input.current?.x ?? 0
    let ay = input.current?.y ?? 0
    keys.current.forEach((code) => {
      const k = KEYS[code]
      if (k) {
        ax += k[0]
        ay += k[1]
      }
    })
    const len = Math.hypot(ax, ay)
    const running = keys.current.has('ShiftLeft') || keys.current.has('ShiftRight') || (input.current ? Math.hypot(input.current.x, input.current.y) > 0.95 : false)
    let move = { dx: 0, dz: 0 }
    cam.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()
    if (len >= 0.05) {
      auto.current = null // tomar el control cancela el recorrido automático
      if (len > 1) {
        ax /= len
        ay /= len
      }
      right.crossVectors(forward, cam.up).normalize()
      const step = SPEED * (running ? RUN : 1) * dt
      move = { dx: (forward.x * ay + right.x * ax) * step, dz: (forward.z * ay + right.z * ax) * step }
    } else if (auto.current) {
      const a = auto.current
      const target = a.points[0]
      const b = body.current
      if (target) {
        const dx = target.x - b.x
        const dz = target.y - b.z
        const d = Math.hypot(dx, dz)
        if (d < 0.08) a.points.shift()
        else {
          const step = Math.min(d, SPEED * 0.8 * dt)
          move = { dx: (dx / d) * step, dz: (dz / d) * step }
          // mira hacia donde camina (suave)
          const e = euler.current.setFromQuaternion(cam.quaternion)
          const want = yawToward(dx, dz)
          const diff = Math.atan2(Math.sin(want - e.y), Math.cos(want - e.y))
          e.y += diff * Math.min(1, dt * 6)
          e.x *= 1 - Math.min(1, dt * 4)
          cam.quaternion.setFromEuler(e)
        }
      } else if (a.yaw !== undefined) {
        const e = euler.current.setFromQuaternion(cam.quaternion)
        const diff = Math.atan2(Math.sin(a.yaw - e.y), Math.cos(a.yaw - e.y))
        e.y += diff * Math.min(1, dt * 5)
        cam.quaternion.setFromEuler(e)
        if (Math.abs(diff) < 0.02) auto.current = null
      } else auto.current = null
    }

    const before = body.current
    body.current = stepCharacter(before, move, dt, world, doorPassable)
    const b = body.current
    const moved = Math.hypot(b.x - before.x, b.z - before.z)
    if (auto.current && (move.dx !== 0 || move.dz !== 0)) {
      auto.current.stuck = moved < 1e-4 ? auto.current.stuck + dt : 0
      if (auto.current.stuck > 0.8) auto.current = null // algo lo bloquea: se rinde
    }
    // balanceo leve al caminar (sin él si la persona prefiere menos movimiento)
    bob.current += moved * 6
    const sway = reduced ? 0 : Math.sin(bob.current) * 0.025 * Math.min(1, moved / (SPEED * dt + 1e-6))
    cam.position.set(b.x, b.y + EYE + sway, b.z)

    frame.current++
    if (frame.current % 6 !== 0) return

    // puertas automáticas: abre la que está cerca y al frente; cierra las que quedaron atrás
    if (st.autoDoors) {
      const near = nearestDoor(world, b.levelId, { x: b.x, y: b.z }, AUTO_DOOR)
      if (near && !st.doors[near.openingId]) {
        const facing = forward.x * (near.center.x - b.x) + forward.z * (near.center.y - b.z) > 0
        if (facing) {
          st.setDoor(near.openingId, true)
          autoOpened.current.add(near.openingId)
        }
      }
      for (const id of autoOpened.current) {
        const d = world.doors.find((x) => x.openingId === id)
        if (d && Math.hypot(d.center.x - b.x, d.center.y - b.z) > 2.6) {
          st.setDoor(id, false)
          autoOpened.current.delete(id)
        }
      }
    }

    // mirar y actuar: ¿qué hay al frente, al alcance?
    let focus: Focus = null
    if (root) {
      ray.setFromCamera(new THREE.Vector2(0, 0), cam)
      ray.far = REACH
      const hit = ray.intersectObject(root, true).find((h) => h.object.visible)
      const k = hit ? kindOf(hit.object) : null
      if (k?.kind === 'door') {
        const id = String(k.data.openingId)
        focus = { kind: 'door', id, open: !!useWalk.getState().doors[id] }
      } else if (k?.kind === 'window') focus = { kind: 'window', id: String(k.data.openingId) }
      else if (k?.kind === 'stair') {
        const found = stairs.find((x) => x.s.id === String(k.data.stairId))
        if (found) {
          const top = found.elevation + (found.s.base ?? 0) + found.s.riser * found.s.steps
          focus = { kind: 'stair', id: found.s.id, up: b.y < top - 0.5 }
        }
      }
    }
    st.setFocus(focus)

    const idx = world.levels.findIndex((l) => l.id === b.levelId)
    st.setHud({
      x: b.x,
      z: b.z,
      y: b.y,
      heading: Math.atan2(forward.z, forward.x),
      levelId: b.levelId,
      levelIndex: idx,
      levelCount: world.levels.length,
      levelName: world.levels[idx]?.name ?? '',
    })
  })

  return touch ? null : <PointerLockControls selector="#walk-start" />
}

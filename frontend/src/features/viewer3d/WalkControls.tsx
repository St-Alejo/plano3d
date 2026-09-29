/**
 * Modo "Recorrer" en primera persona.
 * - Escritorio: clic para capturar el mouse (pointer lock), WASD / flechas para caminar.
 * - Táctil: joystick en pantalla para caminar y arrastrar para mirar.
 * La colisión (dominio puro, `resolveCollision`) impide atravesar muros; las puertas sí se cruzan.
 */
import { PointerLockControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { BuildingModel, Point } from '@/api/types'
import { bestViewAngle, obstaclesFromWalls, resolveCollision } from '@/domain/collision'

export const EYE_HEIGHT = 1.6
const SPEED = 2.2 // m/s
const RADIUS = 0.25
const LOOK_SPEED = 0.005
// vectores de trabajo reutilizados en cada frame (sin crear basura para el GC)
const forward = new THREE.Vector3()
const right = new THREE.Vector3()

/** Entrada compartida entre el joystick (HTML) y el bucle de render. */
export interface WalkInput {
  x: number // -1..1 lateral
  y: number // -1..1 adelante
}

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

function useKeyboardAxis() {
  const pressed = useRef(new Set<string>())
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code in KEYS && !(e.target instanceof HTMLInputElement)) pressed.current.add(e.code)
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

export function WalkControls({
  model,
  start,
  input,
  touch,
}: {
  model: BuildingModel
  start: Point
  input: React.RefObject<WalkInput>
  touch: boolean
}) {
  const { camera, gl } = useThree()
  const keys = useKeyboardAxis()
  const obstacles = useMemo(() => obstaclesFromWalls(model.levels.flatMap((l) => l.walls)), [model])
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))

  const { x: sx, y: sy } = start
  useEffect(() => {
    camera.position.set(sx, EYE_HEIGHT, sy)
    // se empieza mirando hacia donde hay más espacio libre, no contra un muro
    const a = bestViewAngle({ x: sx, y: sy }, obstacles)
    const yaw = Math.atan2(-Math.cos(a), -Math.sin(a))
    euler.current.set(0, yaw, 0)
    camera.quaternion.setFromEuler(euler.current)
  }, [camera, sx, sy, obstacles])

  // mirar arrastrando el dedo (sin pointer lock en móviles)
  useEffect(() => {
    if (!touch) return
    const el = gl.domElement
    let last: { x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY }
    }
    const move = (e: PointerEvent) => {
      if (!last) return
      const e2 = euler.current.setFromQuaternion(camera.quaternion)
      e2.y -= (e.clientX - last.x) * LOOK_SPEED
      e2.x = THREE.MathUtils.clamp(e2.x - (e.clientY - last.y) * LOOK_SPEED, -1.2, 1.2)
      camera.quaternion.setFromEuler(e2)
      last = { x: e.clientX, y: e.clientY }
    }
    const up = () => {
      last = null
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [touch, gl, camera])


  useFrame(({ camera: cam }, dt) => {
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
    if (len < 0.05) return
    if (len > 1) {
      ax /= len
      ay /= len
    }
    cam.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()
    right.crossVectors(forward, cam.up).normalize()
    const step = SPEED * Math.min(dt, 0.1)
    const nx = cam.position.x + (forward.x * ay + right.x * ax) * step
    const nz = cam.position.z + (forward.z * ay + right.z * ax) * step
    const p = resolveCollision({ x: nx, y: nz }, obstacles, RADIUS)
    cam.position.set(p.x, EYE_HEIGHT, p.y)
  })

  return touch ? null : <PointerLockControls selector="#walk-start" />
}

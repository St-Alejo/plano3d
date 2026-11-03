/**
 * Animación de puertas: cada pivote (`userData.anim`, ver SceneBuilder.withDoors) avanza
 * hacia abierta o cerrada según `useWalk().doors`. El avance (0..1) se guarda por puerta
 * para que la física sepa si ya se puede pasar.
 */
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useWalk } from './walkStore'

/** pose en el marco del padre: posición en planta y giro (hojas de portón plegable) */
type Pose = [x: number, z: number, rotationY: number]
type Anim =
  | { type: 'rotate'; closed: number; open: number }
  | { type: 'slide'; closed: [number, number]; open: [number, number] }
  | { type: 'pose'; closed: Pose; open: Pose }

interface Pivot {
  node: THREE.Object3D
  openingId: string
  anim: Anim
}

/** segundos que tarda en abrir o cerrar */
export const DOOR_SECONDS = 0.45

/** avance de apertura por puerta (0 cerrada, 1 abierta) */
const progress = new Map<string, number>()
const pivotCache = new WeakMap<THREE.Object3D, Pivot[]>()

export const doorProgress = (id: string) => progress.get(id) ?? 0
/** se puede pasar por el vano cuando la hoja ya abrió más de la mitad */
export const doorPassable = (id: string) => doorProgress(id) > 0.5

export function resetDoorProgress(): void {
  progress.clear()
}

function pivotsOf(root: THREE.Object3D): Pivot[] {
  let list = pivotCache.get(root)
  if (!list) {
    list = []
    root.traverse((o) => {
      const anim = o.userData?.anim as Anim | undefined
      if (anim) list!.push({ node: o, openingId: String(o.userData.openingId), anim })
    })
    pivotCache.set(root, list)
  }
  return list
}

const ease = (t: number) => t * t * (3 - 2 * t)

function apply(p: Pivot, t: number): void {
  const e = ease(t)
  if (p.anim.type === 'rotate') p.node.rotation.y = p.anim.closed + (p.anim.open - p.anim.closed) * e
  else if (p.anim.type === 'pose') {
    const [x0, z0, r0] = p.anim.closed
    const [x1, z1, r1] = p.anim.open
    p.node.position.x = x0 + (x1 - x0) * e
    p.node.position.z = z0 + (z1 - z0) * e
    p.node.rotation.y = r0 + (r1 - r0) * e
  } else {
    p.node.position.x = p.anim.closed[0] + (p.anim.open[0] - p.anim.closed[0]) * e
    p.node.position.z = p.anim.closed[1] + (p.anim.open[1] - p.anim.closed[1]) * e
  }
}

/** Avanza todas las puertas `dt` segundos hacia su estado pedido (función pura sobre la escena). */
export function stepDoors(root: THREE.Object3D, targets: Record<string, boolean>, dt: number): void {
  const speed = dt / DOOR_SECONDS
  // un vano puede tener varias hojas (doble batiente, portón): avanza una vez por vano
  const advanced = new Map<string, number>()
  for (const p of pivotsOf(root)) {
    let next = advanced.get(p.openingId)
    if (next === undefined) {
      const goal = targets[p.openingId] ? 1 : 0
      const cur = progress.get(p.openingId) ?? 0
      next = goal > cur ? Math.min(goal, cur + speed) : Math.max(goal, cur - speed)
      advanced.set(p.openingId, next)
      if (next !== cur) progress.set(p.openingId, next)
    }
    apply(p, next)
  }
}

/** Componente dentro del Canvas: anima las puertas en cualquier modo (orbitar o recorrer). */
export function DoorAnimator({ root }: { root: THREE.Object3D | null }) {
  useFrame((_, dt) => {
    if (root) stepDoors(root, useWalk.getState().doors, Math.min(dt, 0.1))
  })
  return null
}

/** Sube por los padres hasta encontrar qué es lo tocado (puerta, ventana, escalera, muro…). */
export function kindOf(obj: THREE.Object3D | null): { kind: string; data: Record<string, unknown> } | null {
  for (let o = obj; o; o = o.parent) {
    const kind = o.userData?.kind
    if (typeof kind === 'string') return { kind, data: o.userData as Record<string, unknown> }
  }
  return null
}

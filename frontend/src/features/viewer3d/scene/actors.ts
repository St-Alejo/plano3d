/**
 * Mallas de la simulación: maniquíes estilizados (cajas y esferas, articulados en cadera,
 * rodilla y hombro) y un carro procedural. Sin modelos externos, como los muebles.
 *
 * Orientación: ambos miran hacia +z local. Un rumbo en planta `yaw` (0 = +x) se pone con
 * `rotation.y = π/2 − yaw`.
 */
import * as THREE from 'three'
import type { Activity } from '@/domain/simulation/agents'
import { CAR_LENGTH, CAR_WIDTH, WHEEL_RADIUS } from '@/domain/simulation/car'

const SHIRTS = ['#c2553a', '#3c6f93', '#e2b23a', '#4f8a5b', '#8a4f9c', '#d27a9a', '#2f3640', '#e8e4da']
const PANTS = ['#2b3a55', '#3d3a36', '#6b5a45', '#1f2326', '#55606b']
const SKINS = ['#f1d0b5', '#d9a77f', '#b07b55', '#7d5236', '#e6bc98']
const HAIR = ['#2a1d14', '#5b3a22', '#b8873d', '#141414', '#8c8c8c']
const PAINT = ['#b3261e', '#e9e9e6', '#1e2a38', '#7a8085', '#2f5d8a']

/** Materiales compartidos por color (se liberan con `disposeActors`). */
const materials = new Map<string, THREE.MeshStandardMaterial>()
function mat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const key = `${color}:${JSON.stringify(opts)}`
  let m = materials.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...opts })
    materials.set(key, m)
  }
  return m
}

const geometries = new Map<string, THREE.BufferGeometry>()
function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `b:${w}:${h}:${d}`
  let g = geometries.get(key)
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d)
    geometries.set(key, g)
  }
  return g
}
function sphereGeo(r: number): THREE.BufferGeometry {
  const key = `s:${r}`
  let g = geometries.get(key)
  if (!g) {
    g = new THREE.SphereGeometry(r, 14, 10)
    geometries.set(key, g)
  }
  return g
}
function cylGeo(r: number, h: number): THREE.BufferGeometry {
  const key = `c:${r}:${h}`
  let g = geometries.get(key)
  if (!g) {
    g = new THREE.CylinderGeometry(r, r, h, 18)
    geometries.set(key, g)
  }
  return g
}

function part(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, kind: string): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.userData.kind = kind
  return mesh
}

function pivot(x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group()
  g.position.set(x, y, z)
  return g
}

// ----------------------------------------------------------------------------- personas

export interface PersonRig {
  root: THREE.Group
  body: THREE.Group
  hips: [THREE.Group, THREE.Group]
  knees: [THREE.Group, THREE.Group]
  shoulders: [THREE.Group, THREE.Group]
  color: string
  phase: number
}

const HIP = 0.9
const THIGH = 0.45
const SHIN = 0.45

export function createPerson(index: number): PersonRig {
  const shirt = SHIRTS[index % SHIRTS.length]!
  const pants = PANTS[(index * 3 + 1) % PANTS.length]!
  const skin = SKINS[(index * 2 + 1) % SKINS.length]!
  const hair = HAIR[(index * 5 + 2) % HAIR.length]!
  const root = new THREE.Group()
  root.name = `persona:${index}`
  root.userData.kind = 'person'
  const body = new THREE.Group()
  root.add(body)
  const legs = [-1, 1].map((s) => {
    const hip = pivot(s * 0.09, HIP, 0)
    hip.add(part(boxGeo(0.14, THIGH, 0.15), mat(pants), 0, -THIGH / 2, 0, 'person'))
    const knee = pivot(0, -THIGH, 0)
    knee.add(part(boxGeo(0.12, SHIN, 0.13), mat(pants), 0, -SHIN / 2, 0, 'person'))
    knee.add(part(boxGeo(0.12, 0.07, 0.24), mat('#262626'), 0, -SHIN + 0.035, 0.05, 'person'))
    hip.add(knee)
    body.add(hip)
    return { hip, knee }
  })
  body.add(part(boxGeo(0.34, 0.16, 0.2), mat(pants), 0, HIP + 0.04, 0, 'person'))
  body.add(part(boxGeo(0.38, 0.5, 0.22), mat(shirt), 0, HIP + 0.36, 0, 'person'))
  body.add(part(boxGeo(0.09, 0.08, 0.09), mat(skin), 0, HIP + 0.65, 0, 'person'))
  body.add(part(sphereGeo(0.115), mat(skin, { roughness: 0.6 }), 0, HIP + 0.8, 0, 'person'))
  const cap = part(sphereGeo(0.12), mat(hair, { roughness: 0.9 }), 0, HIP + 0.83, -0.015, 'person')
  cap.scale.set(1, 0.75, 1)
  body.add(cap)
  const arms = [-1, 1].map((s) => {
    const sh = pivot(s * 0.24, HIP + 0.58, 0)
    sh.add(part(boxGeo(0.09, 0.3, 0.1), mat(shirt), 0, -0.15, 0, 'person'))
    sh.add(part(boxGeo(0.08, 0.3, 0.09), mat(skin), 0, -0.44, 0, 'person'))
    body.add(sh)
    return sh
  })
  return {
    root,
    body,
    hips: [legs[0]!.hip, legs[1]!.hip],
    knees: [legs[0]!.knee, legs[1]!.knee],
    shoulders: [arms[0]!, arms[1]!],
    color: shirt,
    phase: index * 1.7,
  }
}

/** Pone al maniquí en su lugar y postura; `speed` (m/s) mueve las piernas al caminar. */
export function posePerson(rig: PersonRig, p: { x: number; z: number; y: number; yaw: number; pose: Activity | 'walk' }, speed: number, dt: number): void {
  rig.root.position.set(p.x, p.y, p.z)
  rig.root.rotation.y = Math.PI / 2 - p.yaw
  const b = rig.body
  b.rotation.set(0, 0, 0)
  b.position.set(0, 0, 0)
  const [hl, hr] = rig.hips
  const [kl, kr] = rig.knees
  const [al, ar] = rig.shoulders
  let swing = 0
  let hip = 0
  let knee = 0
  let arm = 0
  if (p.pose === 'walk') {
    rig.phase += speed * dt * 5.2
    swing = Math.sin(rig.phase) * Math.min(0.55, speed * 0.5)
  } else if (p.pose === 'sit') {
    hip = -Math.PI / 2
    knee = Math.PI / 2
    b.position.y = -HIP
    arm = -0.5
  } else if (p.pose === 'lie') {
    // acostada boca arriba: la cabeza hacia la cabecera (−z), los pies hacia el frente
    b.rotation.x = -Math.PI / 2
    b.position.set(0, 0.11, 0.85)
  } else if (p.pose === 'work') {
    rig.phase += dt * 3
    arm = -0.9 + Math.sin(rig.phase) * 0.15
  }
  hl.rotation.x = hip + swing
  hr.rotation.x = hip - swing
  kl.rotation.x = knee + Math.max(0, -swing) * 0.8
  kr.rotation.x = knee + Math.max(0, swing) * 0.8
  al.rotation.x = arm - swing * 0.8
  ar.rotation.x = arm + swing * 0.8
  // caminando, un leve rebote
  if (p.pose === 'walk') b.position.y = Math.abs(Math.cos(rig.phase)) * 0.025 * Math.min(1, speed)
}

// ----------------------------------------------------------------------------- carro

export interface CarRig {
  root: THREE.Group
  wheels: THREE.Object3D[]
  lights: THREE.MeshStandardMaterial[]
}

export function createCarMesh(index: number): CarRig {
  const paint = mat(PAINT[index % PAINT.length]!, { roughness: 0.25, metalness: 0.6 })
  const glass = mat('#1c252c', { roughness: 0.08, metalness: 0.3 })
  const trim = mat('#141518', { roughness: 0.6 })
  const root = new THREE.Group()
  root.name = `carro:${index}`
  root.userData.kind = 'car'
  const L = CAR_LENGTH
  const W = CAR_WIDTH
  root.add(part(boxGeo(W, 0.55, L), paint, 0, 0.6, 0, 'car'))
  root.add(part(boxGeo(W - 0.12, 0.5, L * 0.5), glass, 0, 1.12, -0.15, 'car'))
  root.add(part(boxGeo(W - 0.18, 0.06, L * 0.48), paint, 0, 1.4, -0.15, 'car'))
  root.add(part(boxGeo(W + 0.02, 0.16, 0.12), trim, 0, 0.42, L / 2 - 0.02, 'car'))
  root.add(part(boxGeo(W + 0.02, 0.16, 0.12), trim, 0, 0.42, -L / 2 + 0.02, 'car'))
  // faros (blancos) y luces de atrás (rojas): propios de cada carro para prenderlos aparte
  const head = new THREE.MeshStandardMaterial({ color: '#f4f1e6', emissive: '#fff6d8', emissiveIntensity: 0, roughness: 0.3 })
  const tail = new THREE.MeshStandardMaterial({ color: '#7a1010', emissive: '#ff2a1a', emissiveIntensity: 0, roughness: 0.3 })
  for (const s of [-1, 1]) {
    root.add(part(boxGeo(0.34, 0.12, 0.04), head, s * (W / 2 - 0.25), 0.72, L / 2 + 0.005, 'car'))
    root.add(part(boxGeo(0.3, 0.1, 0.04), tail, s * (W / 2 - 0.22), 0.74, -L / 2 - 0.005, 'car'))
  }
  const tire = mat('#1a1a1a', { roughness: 0.9 })
  const rim = mat('#b8bcc0', { roughness: 0.3, metalness: 0.8 })
  const wheels: THREE.Object3D[] = []
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const w = pivot(sx * (W / 2 - 0.08), WHEEL_RADIUS, sz * (L / 2 - 0.75))
      const t = part(cylGeo(WHEEL_RADIUS, 0.22), tire, 0, 0, 0, 'car')
      t.rotation.z = Math.PI / 2
      const r = part(cylGeo(WHEEL_RADIUS * 0.6, 0.23), rim, 0, 0, 0, 'car')
      r.rotation.z = Math.PI / 2
      w.add(t, r)
      root.add(w)
      wheels.push(w)
    }
  return { root, wheels, lights: [head, tail] }
}

export function poseCar(rig: CarRig, c: { x: number; z: number; yaw: number; wheel: number; visible: boolean }, lightsOn: boolean, braking: boolean): void {
  rig.root.visible = c.visible
  rig.root.position.set(c.x, 0, c.z)
  rig.root.rotation.y = Math.PI / 2 - c.yaw
  for (const w of rig.wheels) w.rotation.x = c.wheel
  rig.lights[0]!.emissiveIntensity = lightsOn ? 3 : 0
  rig.lights[1]!.emissiveIntensity = braking ? 3 : lightsOn ? 1.2 : 0
}

export function disposeActors(): void {
  materials.forEach((m) => m.dispose())
  materials.clear()
  geometries.forEach((g) => g.dispose())
  geometries.clear()
}

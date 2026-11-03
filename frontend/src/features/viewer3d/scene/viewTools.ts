/**
 * Herramientas del visor sin React: encuadres de cámara, modos de visualización y
 * exportación OBJ. Se prueban en Node con three.
 */
import * as THREE from 'three'
import type { BuildingModel } from '@/api/types'
import type { Bounds } from '@/domain/model'
import { DEFAULT_STOREY_HEIGHT } from '@/domain/levels'

export type CameraPreset = 'iso' | 'top' | 'front' | 'dollhouse'
export type DisplayMode = 'material' | 'wire' | 'xray'

export const PRESET_LABEL: Record<CameraPreset, string> = {
  iso: 'Isométrica',
  dollhouse: 'Maqueta',
  top: 'Planta',
  front: 'Frontal',
}

export const DISPLAY_LABEL: Record<DisplayMode, string> = {
  material: 'Materiales',
  wire: 'Alámbrico',
  xray: 'Rayos X',
}

/** Posición de cámara y punto mirado para cada encuadre (en metros de la escena). */
export function cameraPreset(name: CameraPreset, b: Bounds): { position: [number, number, number]; target: [number, number, number] } {
  const { center, size } = b
  const target: [number, number, number] = [center.x, 0, center.y]
  switch (name) {
    case 'top':
      // un pelo de desplazamiento en z evita la singularidad de mirar exactamente hacia abajo
      return { position: [center.x, size * 1.6, center.y + 0.001], target }
    case 'front':
      return { position: [center.x, 1.6, b.maxY + size * 1.3], target: [center.x, 1.2, center.y] }
    case 'dollhouse':
      return { position: [center.x + size * 0.7, size * 1.25, center.y + size * 0.7], target }
    case 'iso':
    default:
      return { position: [center.x + size * 0.6, size * 0.9, center.y + size * 1.1], target }
  }
}

/** Alto total del edificio: el techo del piso más alto (con sus muros) sobre el suelo. */
export function buildingHeight(m: BuildingModel): number {
  const tops = m.levels.map((lv) => lv.elevation + Math.max(lv.height ?? DEFAULT_STOREY_HEIGHT, ...lv.walls.map((w) => w.height)))
  return Math.max(DEFAULT_STOREY_HEIGHT, ...tops)
}

/**
 * Aleja una vista (posición → objetivo) hasta que la caja del edificio (planta + `height` de alto) quepa
 * en la pantalla con su proporción `aspect`: en un celular vertical el ancho visible es el que manda.
 * Nunca acerca: en pantallas anchas la vista queda como estaba.
 */
export function fitFraming(
  view: { position: [number, number, number]; target: [number, number, number] },
  b: Bounds,
  height: number,
  aspect: number,
  fovDeg = 55,
): { position: [number, number, number]; target: [number, number, number] } {
  const target: [number, number, number] = [view.target[0], Math.max(view.target[1], height * 0.35), view.target[2]]
  const dir = new THREE.Vector3(view.position[0] - view.target[0], view.position[1] - view.target[1], view.position[2] - view.target[2])
  const base = dir.length()
  dir.normalize()
  const radius = 0.5 * Math.hypot(b.maxX - b.minX, b.maxY - b.minY, height)
  const vHalf = ((fovDeg / 2) * Math.PI) / 180
  const hHalf = Math.atan(Math.tan(vHalf) * aspect)
  const needed = (radius / Math.sin(Math.min(vHalf, hHalf))) * 1.02
  const d = Math.max(base, needed)
  return { position: [target[0] + dir.x * d, target[1] + dir.y * d, target[2] + dir.z * d], target }
}

interface Saved {
  wireframe: boolean
  transparent: boolean
  opacity: number
  depthWrite: boolean
}

/**
 * Aplica un modo de visualización a todos los materiales de la escena. Guarda los
 * valores originales la primera vez, así volver a "Materiales" deja todo como estaba.
 */
export function applyDisplayMode(root: THREE.Object3D, mode: DisplayMode): void {
  const seen = new Set<THREE.Material>()
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats as THREE.Material[]) {
      if (seen.has(m)) continue
      seen.add(m)
      const saved = (m.userData.display ??= {
        wireframe: 'wireframe' in m ? Boolean((m as THREE.MeshStandardMaterial).wireframe) : false,
        transparent: m.transparent,
        opacity: m.opacity,
        depthWrite: m.depthWrite,
      }) as Saved
      if ('wireframe' in m) (m as THREE.MeshStandardMaterial).wireframe = mode === 'wire' ? true : saved.wireframe
      if (mode === 'xray') {
        m.transparent = true
        m.opacity = Math.min(saved.opacity, 0.3)
        m.depthWrite = false
      } else {
        m.transparent = saved.transparent
        m.opacity = saved.opacity
        m.depthWrite = saved.depthWrite
      }
      m.needsUpdate = true
    }
  })
}

/** Exporta la escena como OBJ (texto), para programas que no leen glTF. */
export async function exportObj(root: THREE.Object3D): Promise<Blob> {
  const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js')
  return new Blob([new OBJExporter().parse(root)], { type: 'model/obj' })
}

export const distance3 = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/**
 * Herramientas del visor sin React: encuadres de cámara, modos de visualización y
 * exportación OBJ. Se prueban en Node con three.
 */
import * as THREE from 'three'
import type { Bounds } from '@/domain/model'

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

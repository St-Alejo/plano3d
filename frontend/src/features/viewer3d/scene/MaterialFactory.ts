/**
 * Factory de materiales PBR. Centraliza la creación (y la caché) para que toda la
 * escena comparta instancias y el piso de cada ambiente tome un material
 * coherente con su tipo ("cocina" → cerámica, "dormitorio" → madera...).
 */
import * as THREE from 'three'
import type { Tone } from '@/domain/catalog'
import { floorMaterial, wallMaterial, type Pattern } from '@/domain/materials'

export type WallPart = 'solid' | 'sill' | 'lintel'

interface FloorSpec {
  color: string
  roughness: number
}

const FLOORS: { match: RegExp; spec: FloorSpec }[] = [
  { match: /cocin|kitchen/i, spec: { color: '#d9d4c7', roughness: 0.35 } },
  { match: /ba[ñn]o|bath|toilet/i, spec: { color: '#cfd8dc', roughness: 0.25 } },
  { match: /dormi|habita|bed|cuarto/i, spec: { color: '#b08a64', roughness: 0.6 } },
  { match: /sala|living|estar|comedor/i, spec: { color: '#a67c52', roughness: 0.55 } },
  { match: /patio|terraza|balc/i, spec: { color: '#9e9e92', roughness: 0.85 } },
]
const DEFAULT_FLOOR: FloorSpec = { color: '#bfae96', roughness: 0.6 }

const TONES: Record<Tone, { color: string; roughness: number; metalness?: number; opacity?: number }> = {
  wood: { color: '#9a7452', roughness: 0.6 },
  soft: { color: '#e9e4d8', roughness: 0.95 },
  fabric: { color: '#8a8f99', roughness: 0.95 },
  white: { color: '#f4f4f0', roughness: 0.35 },
  metal: { color: '#c9cdd1', roughness: 0.35, metalness: 0.6 },
  dark: { color: '#3b3b3b', roughness: 0.6 },
  glass: { color: '#cfeaf2', roughness: 0.05, opacity: 0.3 },
  plant: { color: '#5e7d4a', roughness: 0.9 },
}

/**
 * Textura procedural de piso (tablas o baldosas) de 1 m de lado. Las caras de piso usan
 * coordenadas en metros como UV, así el patrón queda a escala real en cualquier ambiente.
 * Sin canvas (pruebas en Node) se devuelve null y el piso queda de color liso.
 */
function patternTexture(pattern: Pattern, color: string): THREE.Texture | null {
  if (!pattern || typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 256, 256)
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'
  ctx.lineWidth = 2
  if (pattern === 'planks') {
    // tablas de 0,2 m con juntas desfasadas
    for (let row = 0; row < 5; row++) {
      const y = row * 51.2
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(256, y)
      const off = (row % 2) * 128
      ctx.moveTo(off, y)
      ctx.lineTo(off, y + 51.2)
      ctx.stroke()
    }
  } else {
    // baldosas de 0,5 m
    const step = pattern === 'tiles' ? 128 : 64
    for (let i = 0; i <= 256; i += step) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i, 256)
      ctx.moveTo(0, i)
      ctx.lineTo(256, i)
      ctx.stroke()
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class MaterialFactory {
  private readonly cache = new Map<string, THREE.Material>()

  private cached<M extends THREE.Material>(key: string, make: () => M): M {
    let m = this.cache.get(key)
    if (!m) {
      m = make()
      m.name = key
      this.cache.set(key, m)
    }
    return m as M
  }

  /** Muro con su acabado (id del catálogo de materiales; desconocido = pañete). */
  wall(part: WallPart = 'solid', materialId = 'plaster'): THREE.MeshStandardMaterial {
    const spec = wallMaterial(materialId) ?? wallMaterial('plaster')!
    return this.cached(`wall:${spec.id}:${part}`, () => {
      const m = new THREE.MeshStandardMaterial({ color: spec.color, roughness: spec.roughness })
      // dinteles y antepechos un tono más oscuro: se leen los huecos a la distancia
      if (part !== 'solid') m.color.multiplyScalar(0.95)
      return m
    })
  }

  /** Piso del ambiente: el acabado elegido o, si no hay, uno según su nombre. */
  floor(materialId: string | null | undefined, label: string): THREE.MeshStandardMaterial {
    const spec = floorMaterial(materialId)
    if (!spec) return this.floorFor(label)
    return this.cached(`floor:${spec.id}`, () => {
      const map = patternTexture(spec.pattern, spec.color)
      return new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : spec.color, map, roughness: spec.roughness })
    })
  }

  /** Material de una parte de mueble según su tono. */
  tone(tone: Tone): THREE.MeshStandardMaterial {
    const t = TONES[tone]
    return this.cached(
      `tone:${tone}`,
      () =>
        new THREE.MeshStandardMaterial({
          color: t.color,
          roughness: t.roughness,
          metalness: t.metalness ?? 0,
          transparent: t.opacity !== undefined,
          opacity: t.opacity ?? 1,
        }),
    )
  }

  floorFor(label: string): THREE.MeshStandardMaterial {
    const spec = FLOORS.find((f) => f.match.test(label))?.spec ?? DEFAULT_FLOOR
    return this.cached(
      `floor:${spec.color}`,
      () => new THREE.MeshStandardMaterial({ color: spec.color, roughness: spec.roughness }),
    )
  }

  column(): THREE.MeshStandardMaterial {
    return this.cached('column', () => new THREE.MeshStandardMaterial({ color: '#c9c6bd', roughness: 0.8 }))
  }

  stair(): THREE.MeshStandardMaterial {
    return this.cached('stair', () => new THREE.MeshStandardMaterial({ color: '#a98c6a', roughness: 0.6 }))
  }

  door(): THREE.MeshStandardMaterial {
    return this.cached('door', () => new THREE.MeshStandardMaterial({ color: '#8d6e4f', roughness: 0.55 }))
  }

  glass(): THREE.MeshPhysicalMaterial {
    return this.cached(
      'glass',
      () =>
        new THREE.MeshPhysicalMaterial({
          color: '#bfe9f2',
          transparent: true,
          opacity: 0.35,
          roughness: 0.05,
          transmission: 0.6,
        }),
    )
  }

  highlight(): THREE.MeshStandardMaterial {
    return this.cached('highlight', () => new THREE.MeshStandardMaterial({ color: '#5fd4e8', emissive: '#1b6f80' }))
  }

  ground(): THREE.MeshStandardMaterial {
    return this.cached('ground', () => new THREE.MeshStandardMaterial({ color: '#0f213d', roughness: 1 }))
  }

  dispose(): void {
    this.cache.forEach((m) => {
      if (m instanceof THREE.MeshStandardMaterial) m.map?.dispose()
      m.dispose()
    })
    this.cache.clear()
  }
}

/**
 * Factory de materiales PBR. Centraliza la creación (y la caché) para que toda la
 * escena comparta instancias y el piso de cada ambiente tome un material
 * coherente con su tipo ("cocina" → cerámica, "dormitorio" → madera...).
 */
import * as THREE from 'three'

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

  wall(part: WallPart = 'solid'): THREE.MeshStandardMaterial {
    // dinteles y antepechos un tono más oscuro: se leen los huecos a la distancia
    const color = part === 'solid' ? '#eef0e6' : '#e1e4d8'
    return this.cached(`wall:${part}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.9 }))
  }

  floorFor(label: string): THREE.MeshStandardMaterial {
    const spec = FLOORS.find((f) => f.match.test(label))?.spec ?? DEFAULT_FLOOR
    return this.cached(
      `floor:${spec.color}`,
      () => new THREE.MeshStandardMaterial({ color: spec.color, roughness: spec.roughness }),
    )
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
    this.cache.forEach((m) => m.dispose())
    this.cache.clear()
  }
}

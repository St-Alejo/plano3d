/**
 * Factory de materiales PBR. Centraliza la creación (y la caché) para que toda la
 * escena comparta instancias y el piso de cada ambiente tome un material
 * coherente con su tipo ("cocina" → cerámica, "dormitorio" → madera...).
 */
import * as THREE from 'three'
import type { Tone } from '@/domain/catalog'
import { floorMaterial, TEXTURES, wallMaterial, type MaterialSpec, type Pattern, type TextureId } from '@/domain/materials'

export type WallPart = 'solid' | 'sill' | 'lintel'

interface FloorSpec {
  color: string
  roughness: number
  /** acabado del catálogo que se usa cuando hay texturas */
  material: string
}

const FLOORS: { match: RegExp; spec: FloorSpec }[] = [
  { match: /cocin|kitchen/i, spec: { color: '#d9d4c7', roughness: 0.35, material: 'porcelanato' } },
  { match: /ba[ñn]o|bath|toilet/i, spec: { color: '#cfd8dc', roughness: 0.25, material: 'baldosa_gris' } },
  { match: /dormi|habita|alcoba|bed|cuarto/i, spec: { color: '#b08a64', roughness: 0.6, material: 'madera_roble' } },
  { match: /sala|living|estar|comedor/i, spec: { color: '#a67c52', roughness: 0.55, material: 'madera_roble' } },
  { match: /patio|terraza|balc/i, spec: { color: '#9e9e92', roughness: 0.85, material: 'cemento' } },
]
const DEFAULT_FLOOR: FloorSpec = { color: '#bfae96', roughness: 0.6, material: 'porcelanato' }

export interface MaterialOptions {
  /**
   * Cargar las fotos PBR (color, relieve y rugosidad). Apagado por defecto: en las
   * pruebas no hay imágenes y el resultado es el material de color liso de siempre.
   */
  textures?: boolean
  /** raíz de los archivos públicos (import.meta.env.BASE_URL) */
  base?: string
}

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
  private readonly maps = new Map<string, THREE.Texture>()
  private readonly loader: THREE.TextureLoader | null
  private readonly base: string

  constructor(options: MaterialOptions = {}) {
    this.loader = options.textures && typeof document !== 'undefined' ? new THREE.TextureLoader() : null
    this.base = options.base ?? '/'
  }

  get textured(): boolean {
    return this.loader !== null
  }

  /** Un mapa de la textura, repetido cada `tileM` metros (las UV de la escena están en metros). */
  private map(id: TextureId, kind: 'color' | 'normal' | 'rough'): THREE.Texture {
    const key = `${id}:${kind}`
    let t = this.maps.get(key)
    if (!t) {
      t = this.loader!.load(`${this.base}texturas/${id}/${kind}.webp`)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      const k = 1 / TEXTURES[id].tileM
      t.repeat.set(k, k)
      t.anisotropy = 8
      if (kind === 'color') t.colorSpace = THREE.SRGBColorSpace
      this.maps.set(key, t)
    }
    return t
  }

  /** Parámetros PBR de una textura, o null si no se cargan texturas. */
  private pbr(id: TextureId | undefined, tint = '#ffffff', normal = 0.8): THREE.MeshStandardMaterialParameters | null {
    if (!this.loader || !id) return null
    return {
      color: tint,
      map: this.map(id, 'color'),
      normalMap: this.map(id, 'normal'),
      normalScale: new THREE.Vector2(normal, normal),
      roughnessMap: this.map(id, 'rough'),
      roughness: 1,
    }
  }

  private finish(spec: MaterialSpec): THREE.MeshStandardMaterialParameters | null {
    return this.pbr(spec.texture, spec.tint)
  }

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
      const m = new THREE.MeshStandardMaterial(this.finish(spec) ?? { color: spec.color, roughness: spec.roughness })
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
      const pbr = this.finish(spec)
      if (pbr) return new THREE.MeshStandardMaterial(pbr)
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
    if (this.textured) return this.floor(spec.material, label)
    return this.cached(
      `floor:${spec.color}`,
      () => new THREE.MeshStandardMaterial({ color: spec.color, roughness: spec.roughness }),
    )
  }

  column(): THREE.MeshStandardMaterial {
    return this.cached('column', () => new THREE.MeshStandardMaterial(this.pbr('concreto', '#d2d0c8') ?? { color: '#c9c6bd', roughness: 0.8 }))
  }

  stair(): THREE.MeshStandardMaterial {
    return this.cached('stair', () => new THREE.MeshStandardMaterial(this.pbr('madera', '#c9a582') ?? { color: '#a98c6a', roughness: 0.6 }))
  }

  door(): THREE.MeshStandardMaterial {
    return this.cached('door', () => new THREE.MeshStandardMaterial(this.pbr('madera', '#b48c66', 0.5) ?? { color: '#8d6e4f', roughness: 0.55 }))
  }

  /** guardaescobas y sobrecimiento a la vista */
  skirting(): THREE.MeshStandardMaterial {
    return this.cached('skirting', () => new THREE.MeshStandardMaterial(this.pbr('concreto', '#8e8c86', 0.4) ?? { color: '#8e8c86', roughness: 0.7 }))
  }

  /** perfilería de aluminio de ventanas */
  frame(): THREE.MeshStandardMaterial {
    return this.cached('frame', () => new THREE.MeshStandardMaterial({ color: '#d9dcdc', roughness: 0.35, metalness: 0.7 }))
  }

  /** marco de madera de las puertas */
  doorFrame(): THREE.MeshStandardMaterial {
    return this.cached('doorFrame', () => new THREE.MeshStandardMaterial(this.pbr('madera', '#8f6a4b', 0.5) ?? { color: '#6f5139', roughness: 0.55 }))
  }

  /** alféizar de ventana y andén perimetral */
  sill(): THREE.MeshStandardMaterial {
    return this.cached('sill', () => new THREE.MeshStandardMaterial(this.pbr('concreto', '#e4e2da', 0.5) ?? { color: '#dedcd4', roughness: 0.6 }))
  }

  roof(): THREE.MeshStandardMaterial {
    return this.cached('roof', () => new THREE.MeshStandardMaterial(this.pbr('teja', '#ffffff', 1) ?? { color: '#b5583a', roughness: 0.8 }))
  }

  lawn(): THREE.MeshStandardMaterial {
    return this.cached('lawn', () => new THREE.MeshStandardMaterial(this.pbr('pasto', '#c9d8b0', 0.6) ?? { color: '#7f9a62', roughness: 1 }))
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
    const shared = new Set(this.maps.values())
    this.cache.forEach((m) => {
      // la textura procedural de piso es propia del material
      if (m instanceof THREE.MeshStandardMaterial && m.map && !shared.has(m.map)) m.map.dispose()
      m.dispose()
    })
    this.cache.clear()
    // los mapas PBR se comparten entre materiales: se liberan una sola vez aquí
    this.maps.forEach((t) => t.dispose())
    this.maps.clear()
  }
}

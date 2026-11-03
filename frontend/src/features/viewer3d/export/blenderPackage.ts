/**
 * Paquete para Blender (.zip): el modelo en GLB ordenado por piso y categoría, un script que
 * lo deja listo para render (materiales Cycles, cielo y sol, luces, cámaras, panel) y los datos
 * del proyecto que el script necesita (cámaras, sol, lámparas) en `proyecto.json`.
 *
 * Coordenadas: el visor usa x = planta x, y = arriba, z = planta y. Blender importa el GLB con
 * Z arriba, así que (x, y, z) del visor quedan en (x, −z, y); `proyecto.json` ya va en las de
 * Blender para que el script no tenga que convertir nada.
 */
import * as THREE from 'three'
import { strToU8, zipSync } from 'fflate'
import type { BuildingModel } from '@/api/types'
import { frontNormal } from '@/domain/facadeGeometry'
import { levelSummaries, roomLamps } from '@/domain/levels'
import { modelBounds } from '@/domain/model'
import { sunDirection, type SunPosition } from '@/domain/sun'
import { exportGlb } from '../scene/exportGlb'
import blenderScript from './blender/arquitectura.py?raw'

/** Categoría (colección de Blender) de cada tipo de malla del visor. */
const CATEGORY: Record<string, string> = {
  wall: 'Muros',
  column: 'Estructura',
  structure: 'Estructura',
  footing: 'Estructura',
  room: 'Pisos y losas',
  slab: 'Pisos y losas',
  facade: 'Fachada',
  door: 'Carpintería',
  window: 'Vidrios',
  furniture: 'Muebles',
  stair: 'Escalera',
  roof: 'Cubierta',
  lamp: 'Luminarias',
}
export const CATEGORIES = [...new Set(Object.values(CATEGORY)), 'Detalles']

/** lo que es solo del visor: guías, terreno, resaltados y fantasmas de obra */
const SKIP_KINDS = new Set(['guide', 'site'])
const skipMaterial = (m: THREE.Material) => m.name === 'highlight' || m.name.startsWith('ghost:')

type Info = { kind?: string; levelId?: string }

/** El tipo y el piso de una malla: los suyos o los del grupo que la contiene (muebles, portones). */
function inherited(o: THREE.Object3D): Info {
  const out: Info = {}
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    out.kind ??= typeof p.userData.kind === 'string' ? p.userData.kind : undefined
    out.levelId ??= typeof p.userData.levelId === 'string' ? p.userData.levelId : undefined
  }
  return out
}

/**
 * Árbol nuevo `Casa / Piso N / Categoría / malla`, con cada malla en su posición del mundo y
 * sus datos (`kind`, `levelId`, `level`, `category`) como extras del glTF, que Blender importa
 * como propiedades del objeto. Incluye lo oculto en el visor (muebles apagados, pisos aislados):
 * en Blender se prende y apaga por colección.
 */
export function blenderRoot(root: THREE.Object3D, model: BuildingModel): THREE.Group {
  root.updateMatrixWorld(true)
  const levels = levelSummaries(model)
  const levelName = new Map(levels.map((l) => [l.id, `Piso ${l.number}`]))
  const casa = new THREE.Group()
  casa.name = 'Casa'
  const groups = new Map<string, THREE.Group>()
  const groupFor = (floor: string, category: string) => {
    const key = `${floor}/${category}`
    let g = groups.get(key)
    if (!g) {
      let parent = casa.getObjectByName(floor) as THREE.Group | undefined
      if (!parent) {
        parent = new THREE.Group()
        parent.name = floor
        casa.add(parent)
      }
      g = new THREE.Group()
      g.name = `${floor} · ${category}`
      g.userData = { category, level: floor }
      parent.add(g)
      groups.set(key, g)
    }
    return g
  }
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const info = inherited(o)
    if (info.kind && SKIP_KINDS.has(info.kind)) return
    const materials = Array.isArray(o.material) ? o.material : [o.material]
    if (materials.some(skipMaterial)) return
    const floor = (info.levelId && levelName.get(info.levelId)) || 'General'
    const category = (info.kind && CATEGORY[info.kind]) || 'Detalles'
    const mesh = new THREE.Mesh(o.geometry, o.material)
    mesh.name = o.name || `${category}:${mesh.id}`
    o.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale)
    mesh.userData = {
      ...o.userData,
      kind: info.kind ?? 'detail',
      category,
      level: floor,
      ...(info.levelId ? { levelId: info.levelId } : {}),
      materialName: materials[0]?.name ?? '',
    }
    groupFor(floor, category).add(mesh)
  })
  return casa
}

type Vec3 = [number, number, number]
const r3 = (v: number) => Math.round(v * 1000) / 1000
/** punto de la planta (x, y) a la altura h, en coordenadas de Blender */
const bl = (x: number, y: number, h: number): Vec3 => [r3(x), r3(-y), r3(h)]

export interface BlenderCamera {
  name: string
  location: Vec3
  target: Vec3
  /** mm; 0 = ortográfica (planta) */
  lens: number
  /** cámara horizontal con corrección vertical (shift): las verticales quedan rectas */
  level: boolean
  ortho_scale?: number
  /** planta de un piso: se ocultan los de arriba al renderizarla */
  floor?: number
}

export interface BlenderProject {
  version: 1
  name: string
  units: 'm'
  /** altura total de la casa (m), para encuadrar las cámaras de fachada */
  height: number
  floors: { number: number; name: string; collection: string; elevation: number; height: number }[]
  cameras: BlenderCamera[]
  /** dirección hacia el sol (unitaria), su altura y azimut en grados */
  sun: { direction: Vec3; altitude: number; azimuth: number }
  lamps: { room: string; collection: string; location: Vec3 }[]
  facade: { style: string; custom: boolean }
}

/** Sol por defecto: 10 de la mañana de un día de marzo en Bogotá (luz lateral, sombras cortas). */
const DEFAULT_SUN: SunPosition = { altitude: 52, azimuth: 105 }

/**
 * Cámaras, sol y lámparas para el script, a partir del modelo. `top` es la altura real de la
 * escena (muros, antepecho, cubierta); sin ella se estima con el entrepiso del último piso.
 */
export function blenderProject(model: BuildingModel, name: string, sun: SunPosition | null = null, top?: number): BlenderProject {
  const levels = levelSummaries(model)
  const b = modelBounds(model)
  const last = levels.at(-1)
  const height = top ?? (last ? last.elevation + last.height : 2.5)
  const ground = [...model.levels].sort((a, c) => a.elevation - c.elevation)[0]
  // hacia la calle: del lado del portón; si no hay, el frente es el lado +y de la planta
  const f = (ground && frontNormal(ground)) ?? { x: 0, y: 1 }
  const side = { x: -f.y, y: f.x }
  const s = b.size
  const c = b.center
  const at = (along: number, across: number) => ({ x: c.x + f.x * along + side.x * across, y: c.y + f.y * along + side.y * across })
  const cam = (n: string, p: { x: number; y: number }, h: number, target: { x: number; y: number }, th: number, lens: number, level: boolean): BlenderCamera => ({
    name: n,
    location: bl(p.x, p.y, h),
    target: bl(target.x, target.y, th),
    lens,
    level,
  })
  // de la mitad de la casa a la cara del frente (el fondo de la planta visto desde la calle)
  const half = Math.abs(f.x) * ((b.maxX - b.minX) / 2) + Math.abs(f.y) * ((b.maxY - b.minY) / 2)
  // a 28 mm el cuadro 16:9 abre ~40° en vertical: a 2× la altura cabe la casa entera con aire
  const fachada = at(half + Math.max(10, height * 2), 0)
  const calle = at(half + Math.max(7, height * 1.4), s * 0.45)
  const aerea = at(s * 1.25, s * 1.05)
  const cameras: BlenderCamera[] = [
    cam('Fachada principal', fachada, 1.6, c, 1.6, 28, true),
    cam('Calle (altura de ojos)', calle, 1.6, at(0, -s * 0.1), 1.6, 24, true),
    cam('Aérea 3/4', aerea, height + s * 0.9, c, height * 0.4, 35, false),
    ...levels.map((l) => ({
      name: `Planta ${l.name || `Piso ${l.number}`}`,
      location: bl(c.x, c.y, l.elevation + l.height + 12),
      target: bl(c.x, c.y, l.elevation),
      lens: 0,
      level: false,
      // el ancho ortográfico es el lado largo del cuadro 16:9: que quepa también el fondo
      ortho_scale: r3(Math.max(b.maxX - b.minX, ((b.maxY - b.minY) * 16) / 9) * 1.12),
      floor: l.number,
    })),
  ]
  const sp = sun && sun.altitude > 2 ? sun : DEFAULT_SUN
  const [dx, dy, dz] = sunDirection(sp)
  const floorOf = new Map(levels.map((l) => [l.id, `Piso ${l.number}`]))
  return {
    version: 1,
    name,
    units: 'm',
    height: r3(height),
    floors: levels.map((l) => ({ number: l.number, name: l.name, collection: `Piso ${l.number}`, elevation: r3(l.elevation), height: r3(l.height) })),
    cameras,
    sun: { direction: [r3(dx), r3(-dz), r3(dy)], altitude: r3(sp.altitude), azimuth: r3(sp.azimuth) },
    lamps: roomLamps(model).map((l) => ({ room: l.label, collection: floorOf.get(l.levelId) ?? 'General', location: bl(l.x, l.y, l.ceiling - 0.12) })),
    facade: { style: model.facade ?? 'moderna_blanca', custom: Boolean(model.facade_custom) },
  }
}

export const README = `PLANO 3D — PAQUETE PARA BLENDER
================================

Contenido
  casa.glb               el modelo (un nodo por piso y categoría, con fotos PBR)
  proyecto.json          cámaras, sol y luces del proyecto
  blender/arquitectura.py  el script que deja la escena lista para render

Cómo abrirlo (Blender 4.x)
  1. Descomprima el .zip en una carpeta (no lo abra desde adentro del .zip).
  2. Abra Blender, vaya a la pestaña "Scripting", pulse "Abrir" y elija
     blender/arquitectura.py; luego pulse el botón ▶ (Ejecutar).
  3. En la vista 3D pulse N: en la pestaña "Plano 3D" puede cambiar de cámara,
     prender o apagar cada piso y los muebles, y renderizar todas las cámaras
     (las imágenes quedan en la carpeta renders/ junto al paquete).

Sin abrir la interfaz:
  blender -b -P blender/arquitectura.py -- casa.glb --render

La escena usa Cycles (128 muestras, con eliminación de ruido), cielo físico
(Nishita) y un sol a la hora del estudio solar del visor. El vidrio es de
transmisión real; muros y losas llevan un bisel de 3 mm para que las aristas
reciban luz. Ajuste muestras y resolución en Propiedades > Render si quiere
más calidad o más velocidad.
`

// TextEncoder puede dar un Uint8Array de otro "realm" (jsdom) y fflate lo tomaría por carpeta
const text = (s: string) => new Uint8Array(strToU8(s))

/** El .zip completo, listo para descargar. */
export async function blenderPackage(root: THREE.Object3D, model: BuildingModel, name: string, sun: SunPosition | null = null): Promise<Uint8Array> {
  const glb = await exportGlb(blenderRoot(root, model), { maxTextureSize: 2048 })
  const project = blenderProject(model, name, sun, new THREE.Box3().setFromObject(root).max.y)
  return zipSync({
    // el GLB ya trae las fotos en JPEG: comprimirlo otra vez casi no gana y tarda
    'casa.glb': [new Uint8Array(await glb.arrayBuffer()), { level: 0 }],
    'proyecto.json': text(JSON.stringify(project, null, 2)),
    'blender/arquitectura.py': text(blenderScript),
    'LEEME.txt': text(README.replace(/\n/g, '\r\n')),
  })
}

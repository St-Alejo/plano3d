import * as THREE from 'three'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { BuildingModel, Level, Wall } from '@/api/types'
import { door, sampleModel, windowOp } from '@/test/fixtures'
import { MaterialFactory } from '../scene/MaterialFactory'
import { buildScene, exportRoot } from '../scene/SceneBuilder'
import { blenderPackage, blenderProject, blenderRoot, type BlenderProject } from './blenderPackage'
import script from './blender/arquitectura.py?raw'

/** Dos pisos con portón al frente (+y), una cama arriba y la fachada contemporánea. */
function house(): BuildingModel {
  const m = sampleModel()
  const ground = m.levels[0]!
  ground.walls = ground.walls.map((w): Wall => ({ ...w, kind: w.id === 'w_mid' ? 'interior' : 'exterior' }))
  ground.walls[2] = { ...ground.walls[2]!, openings: [{ ...door('gate', 1, 2), operation: 'folding' }] }
  const upper: Level = {
    ...ground,
    id: 'lvl_1',
    name: 'Piso 2',
    elevation: 2.6,
    walls: ground.walls.map((w) => ({ ...w, id: `${w.id}_2`, openings: w.id === 'w_bottom' ? [windowOp('o_up', 3)] : [] })),
    rooms: ground.rooms.map((r) => ({ ...r, id: `${r.id}_2` })),
    furniture: [{ id: 'f_1', catalog_id: 'cama_doble', position: { x: 2, y: 2 }, width: 1.4, depth: 1.95, height: 1, rotation: 0 }],
  }
  return { ...m, facade: 'moderna_contemporanea', levels: [ground, upper] }
}

const scene = (m: BuildingModel) => buildScene(m, new MaterialFactory(), { facade: true, roof: true, details: true, site: true })

describe('paquete para Blender', () => {
  it('ordena las mallas en Piso N / Categoría, en su lugar del mundo y con sus datos', () => {
    const m = house()
    const s = scene(m)
    // los muebles apagados en el visor igual viajan: en Blender se apagan por colección
    s.furniture.visible = false
    const root = blenderRoot(exportRoot(s), m)
    expect(root.children.map((c) => c.name).sort()).toEqual(['Piso 1', 'Piso 2'])
    const cats = (floor: string) => root.getObjectByName(floor)!.children.map((c) => c.userData.category as string)
    expect(cats('Piso 1')).toEqual(expect.arrayContaining(['Muros', 'Pisos y losas', 'Fachada', 'Carpintería']))
    expect(cats('Piso 2')).toEqual(expect.arrayContaining(['Muros', 'Vidrios', 'Muebles', 'Cubierta']))
    const meshes: THREE.Mesh[] = []
    root.traverse((o) => o instanceof THREE.Mesh && meshes.push(o))
    expect(meshes.every((x) => x.visible && typeof x.userData.kind === 'string' && typeof x.userData.level === 'string')).toBe(true)
    // nada del terreno ni de las guías
    expect(meshes.some((x) => x.userData.kind === 'site' || x.name.startsWith('site:'))).toBe(false)
    // la posición del mundo se conserva: la losa de cubierta queda arriba del piso 2
    const slab = meshes.find((x) => x.name === 'roof:lvl_1:slab')!
    expect(slab.position.y).toBeGreaterThan(2.6 + 2)
    expect(slab.userData.category).toBe('Cubierta')
  })

  it('las cámaras miran la casa: la fachada desde la calle, una planta por piso', () => {
    const p = blenderProject(house(), 'Casa', null)
    expect(p.cameras.map((c) => c.name)).toEqual(['Fachada principal', 'Calle (altura de ojos)', 'Aérea 3/4', 'Planta Planta baja', 'Planta Piso 2'])
    const front = p.cameras[0]!
    // el frente es +y en planta = −y en Blender: la cámara queda más allá de y=−7
    expect(front.location[1]).toBeLessThan(-7)
    expect(front.location[2]).toBeCloseTo(1.6)
    expect(front.level).toBe(true)
    const plan2 = p.cameras.at(-1)!
    expect(plan2).toMatchObject({ lens: 0, floor: 2 })
    expect(plan2.location[2]).toBeGreaterThan(2.6)
    // sol por defecto arriba del horizonte y unitario
    const [x, y, z] = p.sun.direction
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 2)
    expect(z).toBeGreaterThan(0.5)
    expect(p.lamps.length).toBe(4)
    expect(p.lamps.every((l) => l.collection === 'Piso 1' || l.collection === 'Piso 2')).toBe(true)
    expect(p.facade).toEqual({ style: 'moderna_contemporanea', custom: false })
  })

  it('el .zip trae el GLB, el script, los datos y el LÉEME', async () => {
    const m = house()
    const zip = unzipSync(await blenderPackage(exportRoot(scene(m)), m, 'Casa', { altitude: 30, azimuth: 250 }))
    expect(Object.keys(zip).sort()).toEqual(['LEEME.txt', 'blender/arquitectura.py', 'casa.glb', 'proyecto.json'])
    const glb = zip['casa.glb']!
    expect(strFromU8(glb.slice(0, 4))).toBe('glTF')
    const len = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true)
    const doc = JSON.parse(strFromU8(glb.slice(20, 20 + len))) as { nodes: { name?: string; extras?: Record<string, unknown> }[] }
    const names = doc.nodes.map((n) => n.name)
    expect(names).toEqual(expect.arrayContaining(['Casa', 'Piso 1', 'Piso 2', 'Piso 2 · Muebles']))
    const wall = doc.nodes.find((n) => n.extras?.kind === 'wall')!
    expect(wall.extras).toMatchObject({ category: 'Muros', level: 'Piso 1', levelId: 'lvl_0' })
    const project = JSON.parse(strFromU8(zip['proyecto.json']!)) as BlenderProject
    expect(project.sun.altitude).toBe(30)
    expect(project.cameras).toHaveLength(5)
    expect(strFromU8(zip['blender/arquitectura.py']!)).toBe(script)
    expect(strFromU8(zip['LEEME.txt']!)).toContain('Scripting')
  })

  it('el script lee lo que el paquete escribe', () => {
    for (const key of ['"cameras"', '"sun"', '"lamps"', '"floors"', '"level"', '"category"', '"floor"', 'casa.glb', 'proyecto.json'])
      expect(script).toContain(key)
  })
})

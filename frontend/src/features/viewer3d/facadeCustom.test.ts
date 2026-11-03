import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { BuildingModel, Level, Wall } from '@/api/types'
import { applyFacadeEdit, describeFacadeEdit, facadeSpec, isFacadeEdit, resolveFacade, type FacadeState } from '@/domain/facades'
import { door, sampleModel, windowOp } from '@/test/fixtures'
import { MaterialFactory } from './scene/MaterialFactory'
import { buildScene } from './scene/SceneBuilder'
import { asViewerActions, parseViewerChat } from './viewerCommands'

/** Casa de dos pisos: portón abajo en w_bottom (el frente, +y) y una ventana arriba en el frente. */
function twoStorey(facade: BuildingModel['facade'] = 'moderna_contemporanea'): BuildingModel {
  const m = sampleModel()
  const ground = m.levels[0]!
  ground.walls = ground.walls.map((w): Wall => ({ ...w, kind: w.id === 'w_mid' ? 'interior' : 'exterior' }))
  ground.walls[2] = { ...ground.walls[2]!, openings: [{ ...door('gate', 1, 2), operation: 'folding' }] }
  const upper: Level = {
    ...ground,
    id: 'lvl_1',
    name: 'Piso 2',
    elevation: 2.6,
    walls: ground.walls.map((w) => ({ ...w, id: `${w.id}_2`, openings: w.id === 'w_bottom' ? [windowOp('o_up', 3)] : w.id === 'w_top' ? [windowOp('o_back', 2)] : [] })),
    rooms: ground.rooms.map((r) => ({ ...r, id: `${r.id}_2` })),
  }
  return { ...m, facade, levels: [ground, upper] }
}

const meshes = (g: THREE.Object3D) => {
  const out: THREE.Mesh[] = []
  g.traverse((o) => o instanceof THREE.Mesh && out.push(o))
  return out
}
const named = (s: ReturnType<typeof buildScene>, prefix: string) => meshes(s.details).filter((m) => m.name.startsWith(prefix))

describe('fachada paramétrica: detalles en la escena', () => {
  it('la contemporánea pone listones, recuadro, jardinera y apliques solo en el frente y por fuera', () => {
    const s = buildScene(twoStorey(), new MaterialFactory(), { facade: true })
    const slats = named(s, 'slat:')
    const surround = named(s, 'surround:')
    expect(slats.length).toBeGreaterThanOrEqual(3)
    expect(surround).toHaveLength(4)
    expect(named(s, 'planter:').length).toBe(2)
    expect(named(s, 'sconce:')).toHaveLength(2)
    // solo la ventana del frente (o_up), no la de atrás (o_back)
    expect([...slats, ...surround].every((m) => m.name.includes('o_up'))).toBe(true)
    // el frente corre por y=7 y la casa queda en y<7: todo sale hacia la calle
    for (const m of [...slats, ...surround, ...named(s, 'planter:'), ...named(s, 'sconce:')]) {
      expect(m.position.z).toBeGreaterThan(7)
      expect(m.userData.kind).toBe('facade')
    }
  })

  it('el estilo blanco no trae detalles, y prender uno con la personalización lo agrega', () => {
    const plain = buildScene(twoStorey('moderna_blanca'), new MaterialFactory(), { facade: true })
    expect(named(plain, 'slat:')).toHaveLength(0)
    const custom = { ...twoStorey('moderna_blanca'), facade_custom: { features: ['jardinera' as const] } }
    const s = buildScene(custom, new MaterialFactory(), { facade: true })
    expect(named(s, 'planter:').length).toBe(2)
    expect(named(s, 'slat:')).toHaveLength(0)
  })

  it('los detalles no tocan el interior', () => {
    const materials = new MaterialFactory()
    const sig = (m: BuildingModel, facade: boolean) => {
      const s = buildScene(m, materials, { facade, details: true })
      return [s.walls, s.floors, s.furniture, s.glass].flatMap(meshes).map((x) => [x.name, x.position.toArray().join()])
    }
    expect(sig(twoStorey('moderna_contemporanea'), true)).toEqual(sig(twoStorey('moderna_blanca'), false))
  })

  it('el alero agranda la losa de cubierta', () => {
    const slab = (m: BuildingModel) => {
      const mesh = buildScene(m, new MaterialFactory(), { facade: true, roof: true }).root.getObjectByName('roof:lvl_1:slab') as THREE.Mesh
      mesh.geometry.computeBoundingBox()
      return mesh.geometry.boundingBox!.max.x - mesh.geometry.boundingBox!.min.x
    }
    const noEave = { ...twoStorey(), facade_custom: { features: ['listones' as const] } }
    expect(slab(twoStorey()) - slab(noEave)).toBeCloseTo(0.8)
  })
})

describe('fachada paramétrica: cambios', () => {
  const start: FacadeState = { style: 'moderna_blanca', custom: null }

  it('un material para una parte cambia solo esa parte', () => {
    const s = applyFacadeEdit(start, { part: 'upper', material: 'madera' })
    const spec = resolveFacade(s.style, s.custom)
    expect(spec.upper.texture).toBe('madera')
    expect(spec.ground).toEqual(facadeSpec('moderna_blanca').ground)
    expect(spec.custom).toBe(true)
  })

  it('los cambios se suman y elegir un estilo empieza limpio', () => {
    let s = applyFacadeEdit(start, { paint: 'frame', color: '#ffffff' })
    s = applyFacadeEdit(s, { feature: 'jardinera', on: true })
    expect(s.custom).toEqual({ frame: '#ffffff', features: ['jardinera'] })
    s = applyFacadeEdit(s, { style: 'moderna_contemporanea' })
    expect(s).toEqual({ style: 'moderna_contemporanea', custom: null })
    s = applyFacadeEdit(s, { feature: 'jardinera', on: false })
    expect(s.custom?.features).toEqual(['listones', 'marco_ventana', 'alero', 'luces'])
  })

  it('solo el color conserva la foto del revestimiento con otro tinte', () => {
    const s = applyFacadeEdit({ style: 'moderna_ladrillo', custom: null }, { part: 'ground', color: '#8a3b22' })
    const ground = resolveFacade(s.style, s.custom).ground
    expect(ground.texture).toBe('ladrillo')
    expect(ground.tint).toBe('#8a3b22')
  })

  it('valida los cambios que llegan de la IA', () => {
    expect(isFacadeEdit({ part: 'upper', material: 'madera' })).toBe(true)
    expect(isFacadeEdit({ part: 'upper' })).toBe(false)
    expect(isFacadeEdit({ part: 'techo', material: 'madera' })).toBe(false)
    expect(isFacadeEdit({ paint: 'frame', color: 'negro' })).toBe(false)
    expect(isFacadeEdit({ feature: 'piscina', on: true })).toBe(false)
    expect(isFacadeEdit({ style: 'gotica' })).toBe(false)
    expect(describeFacadeEdit({ feature: 'jardinera', on: false })).toBe('Quité la jardinera')
    expect(describeFacadeEdit({ part: 'upper', material: 'madera' })).toBe('Pisos de arriba en madera')
  })
})

describe('chat de la fachada sin IA', () => {
  const cases: [string, unknown][] = [
    ['fachada contemporánea', { style: 'moderna_contemporanea' }],
    ['madera en el segundo piso', { part: 'upper', material: 'madera' }],
    ['el primer piso en ladrillo', { part: 'ground', material: 'ladrillo' }],
    ['marcos negros', { paint: 'frame', color: '#1c1d1f' }],
    ['quita la jardinera', { feature: 'jardinera', on: false }],
    ['pon listones', { feature: 'listones', on: true }],
    ['el portón negro', { part: 'gate', color: '#1c1d1f' }],
  ]
  it.each(cases)('«%s»', (msg, edit) => {
    const r = parseViewerChat(msg)
    expect(r.actions).toEqual([{ a: 'facade', edit }])
    expect(r.unknown).toEqual([])
    expect(r.ambiguous).toEqual([])
  })

  it('lo de obra sigue siendo de obra', () => {
    expect(parseViewerChat('oculta el ladrillo').actions).toEqual([{ a: 'masonry', hidden: true }])
    expect(parseViewerChat('ver piso 2').actions).toEqual([{ a: 'level', n: 2 }])
    expect(parseViewerChat('vista de fachada').actions).toEqual([{ a: 'preset', name: 'front' }])
  })

  it('de la IA solo pasan cambios válidos', () => {
    const raw = [
      { a: 'facade', edit: { part: 'upper', material: 'madera' } },
      { a: 'facade', edit: { part: 'upper', material: 'oro' } },
      { a: 'facade', edit: null },
    ]
    expect(asViewerActions(raw)).toEqual([{ a: 'facade', edit: { part: 'upper', material: 'madera' } }])
  })
})

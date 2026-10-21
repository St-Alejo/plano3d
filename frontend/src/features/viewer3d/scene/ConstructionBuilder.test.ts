import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { describeElement, rebarText } from '@/domain/structure/describe'
import { deriveStructure } from '@/domain/structure/derive'
import { masonryLayout } from '@/domain/structure/masonryLayout'
import { sampleModel } from '@/test/fixtures'
import { obra, planMode } from '../modes'
import { ConstructionBuilder } from './ConstructionBuilder'
import { MaterialFactory } from './MaterialFactory'

const meshes = (g: THREE.Object3D) => {
  const out: THREE.Mesh[] = []
  g.traverse((o) => o instanceof THREE.Mesh && out.push(o))
  return out
}

describe('escena de obra', () => {
  const model = sampleModel()
  const s = deriveStructure(model)
  const bricks = masonryLayout(model, s)

  it('una pieza instanciada por ladrillo, un InstancedMesh por muro', () => {
    const scene = new ConstructionBuilder(model, s, new MaterialFactory()).withMasonry(bricks).build()
    const inst = meshes(scene.walls).filter((m): m is THREE.InstancedMesh => m instanceof THREE.InstancedMesh && m.name.startsWith('ladrillo:'))
    expect(inst.reduce((a, m) => a + m.count, 0)).toBe(bricks.length)
    // el mortero va pieza por pieza (no tapa los vanos): mismo número de instancias
    const mortar = meshes(scene.walls).filter((m): m is THREE.InstancedMesh => m instanceof THREE.InstancedMesh && m.name.startsWith('mortero:'))
    expect(mortar.reduce((a, m) => a + m.count, 0)).toBe(bricks.length)
    expect(inst.length).toBe(new Set(bricks.map((b) => b.wallId)).size)
    // cada instancia sabe a qué paño pertenece (para la ficha al tocarla)
    for (const m of inst) expect((m.userData.panelIds as string[]).length).toBe(m.count)
  })

  it('cada elemento estructural tiene su malla con elementId', () => {
    const scene = new ConstructionBuilder(model, s, new MaterialFactory()).withFoundations().withColumns().withBeams().build()
    const ids = new Set(meshes(scene.elements).map((m) => m.userData.elementId as string))
    for (const e of [...s.columns, ...s.footings, ...s.plinths, ...s.beams, ...s.lintels]) expect(ids.has(e.id)).toBe(true)
    // la cimentación va bajo el piso
    const footing = meshes(scene.elements).find((m) => m.userData.elementKind === 'footing')!
    expect(footing.position.y).toBeLessThan(0)
  })

  it('el modo obra arma la escena y ocultar la mampostería quita el ladrillo', () => {
    expect(planMode('obra')).toBe(obra)
    expect(obra.groundY).toBeLessThan(-0.5)
    const full = obra.build(model, new MaterialFactory())
    const bare = obra.build(model, new MaterialFactory(), { hideMasonry: true })
    expect(full.walls.children.length).toBeGreaterThan(0)
    expect(bare.walls.children.length).toBe(0)
    expect(bare.elements.children.length).toBe(full.elements.children.length)
    expect(full.floors.children.length).toBeGreaterThan(0)
  })
})

describe('ficha del elemento', () => {
  const model = sampleModel()
  const s = deriveStructure(model)

  it('columneta: sección, refuerzo y estribos en lenguaje de obra', () => {
    const c = s.columns[0]!
    const card = describeElement(s, c.id)!
    expect(card.title).toBe(`Columneta ${c.id}`)
    expect(card.lines.join(' ')).toMatch(/4 Nº3/)
    expect(card.lines.join(' ')).toMatch(/estribos Nº2 \(1\/4"\) c\/0,10 en 0,45 m/)
  })

  it('viga de cimentación y paño de muro', () => {
    const f = s.footings[0]!
    expect(describeElement(s, f.id)!.lines.join(' ')).toMatch(/bajo el piso/)
    const p = s.panels[0]!
    const card = describeElement(s, p.id, masonryLayout(model, s))!
    expect(card.lines.join(' ')).toMatch(/\d+ piezas/)
    expect(describeElement(s, 'no-existe')).toBeNull()
  })

  it('rebarText usa coma decimal', () => {
    expect(rebarText(s.columns[0]!.rebar)).not.toMatch(/\d\.\d/)
  })
})

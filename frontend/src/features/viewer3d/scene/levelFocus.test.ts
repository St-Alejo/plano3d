import type * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { BuildingModel } from '@/api/types'
import { rect, sampleModel, wall } from '@/test/fixtures'
import { applyLevelFocus, highlightLevel, levelBounds } from './levelFocus'
import { SceneBuilder } from './SceneBuilder'

function twoStoreys(): BuildingModel {
  const m = sampleModel()
  m.levels.push({
    id: 'lvl_1',
    name: 'Segundo piso',
    elevation: 2.7,
    walls: [wall('u1', 0, 0, 4, 0), wall('u2', 4, 0, 4, 3), wall('u3', 4, 3, 0, 3), wall('u4', 0, 3, 0, 0)],
    rooms: [rect('r_u', 'Alcoba', 0, 0, 4, 3)],
    furniture: [{ id: 'f1', catalog_id: 'closet', position: { x: 2, y: 1.5 }, rotation: 0, width: 1.4, depth: 1.95, height: 0.5 }],
  })
  return m
}

const build = () => new SceneBuilder(twoStoreys()).withWalls().withFloors().withFurniture().build()
const visibleOf = (root: THREE.Object3D, levelId: string) => {
  const out: boolean[] = []
  root.traverse((o) => o.userData.levelId === levelId && out.push(o.visible))
  return out
}
describe('applyLevelFocus', () => {
  it('oculta muros, pisos y muebles del nivel de arriba y los restaura después', () => {
    const { root } = build()
    expect(applyLevelFocus(root, new Set(['lvl_1']))).toBeGreaterThan(4)
    expect(visibleOf(root, 'lvl_1').every((v) => !v)).toBe(true)
    expect(visibleOf(root, 'lvl_0').every(Boolean)).toBe(true)
    applyLevelFocus(root, new Set())
    expect(visibleOf(root, 'lvl_1').every(Boolean)).toBe(true)
  })

  it('no vuelve visible lo que otro ocultó', () => {
    const { root } = build()
    let wallMesh: THREE.Object3D | undefined
    root.traverse((o) => {
      if (!wallMesh && o.userData.wallId === 'u1') wallMesh = o
    })
    if (!wallMesh) throw new Error('sin muro u1')
    wallMesh.visible = false
    applyLevelFocus(root, new Set(['lvl_1']))
    applyLevelFocus(root, new Set())
    expect(wallMesh.visible).toBe(false)
  })
})

describe('highlightLevel', () => {
  it('pone una sola caja a la altura del piso y la quita con null', () => {
    const { root } = build()
    highlightLevel(root, 'lvl_1')
    highlightLevel(root, 'lvl_1')
    const helpers: THREE.Object3D[] = []
    root.traverse((o) => o.name === 'level-highlight' && helpers.push(o))
    expect(helpers).toHaveLength(1)
    expect(levelBounds(root, 'lvl_1').min.y).toBeGreaterThan(2)
    highlightLevel(root, null)
    expect(root.getObjectByName('level-highlight')).toBeUndefined()
  })
})

import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { BuildingModel, Wall } from '@/api/types'
import { outwardSign, skinBoxes } from '@/domain/facadeGeometry'
import { FACADE_STYLES, nextFacade } from '@/domain/facades'
import { wallToBoxes } from '@/domain/geometry'
import { door, sampleModel } from '@/test/fixtures'
import { MaterialFactory } from './scene/MaterialFactory'
import { buildScene } from './scene/SceneBuilder'

/** El departamento de prueba con los muros del contorno marcados de fachada y un portón. */
function house(): BuildingModel {
  const m = sampleModel()
  const lv = m.levels[0]!
  lv.walls = lv.walls.map((w): Wall => ({ ...w, kind: w.id === 'w_mid' ? 'interior' : 'exterior' }))
  lv.walls[2] = { ...lv.walls[2]!, openings: [{ ...door('gate', 1, 2), operation: 'folding' }] }
  return m
}

const meshes = (g: THREE.Object3D) => {
  const out: THREE.Mesh[] = []
  g.traverse((o) => o instanceof THREE.Mesh && out.push(o))
  return out
}

describe('fachada', () => {
  it('la piel va solo en los muros de fachada y por el lado de afuera', () => {
    const s = buildScene(house(), undefined, { facade: true })
    const skin = meshes(s.details).filter((m) => m.name.startsWith('facade:'))
    const walls = new Set(skin.map((m) => m.userData.wallId))
    expect(walls).toEqual(new Set(['w_top', 'w_right', 'w_bottom', 'w_left']))
    // w_top corre por y=0 y los ambientes quedan en y>0: la piel queda en z<0, pegada a la cara
    for (const m of skin.filter((x) => x.userData.wallId === 'w_top')) expect(m.position.z).toBeCloseTo(-0.11)
    for (const m of skin.filter((x) => x.userData.wallId === 'w_right')) expect(m.position.x).toBeCloseTo(10.11)
  })

  it('la piel respeta los vanos: una caja por cada caja del muro y nada en la ventana', () => {
    const w = house().levels[0]!.walls[0]!
    const lv = house().levels[0]!
    const boxes = skinBoxes(w, outwardSign(w, lv))
    expect(boxes).toHaveLength(wallToBoxes(w).length)
    // ventana o_win: offset 2, ancho 1,2, alféizar 0,9, alto 1,2 → centro (2,6; 1,5)
    const inHole = boxes.filter((b) => Math.abs(b.center[0] - 2.6) < b.size[0] / 2 && Math.abs(b.center[1] - 1.5) < b.size[1] / 2)
    expect(inHole).toHaveLength(0)
  })

  it('cambiar el estilo no toca los muros, el piso ni los muebles del interior', () => {
    const materials = new MaterialFactory()
    const signature = (m: BuildingModel, facade: boolean) => {
      const s = buildScene(m, materials, { facade, details: true })
      return [s.walls, s.floors, s.furniture, s.glass].flatMap(meshes).map((x) => [x.name, x.material, x.position.toArray().join(), JSON.stringify(x.userData)])
    }
    const base = signature(house(), false)
    for (const style of FACADE_STYLES) expect(signature({ ...house(), facade: style }, true)).toEqual(base)
  })

  it('cada estilo viste distinto la piel', () => {
    const materials = new MaterialFactory()
    const skinMaterial = (style: BuildingModel['facade']) =>
      (meshes(buildScene({ ...house(), facade: style }, materials, { facade: true }).details).find((m) => m.name.startsWith('facade:w_top'))!.material as THREE.Material).uuid
    expect(new Set(FACADE_STYLES.map(skinMaterial)).size).toBe(3)
    expect(nextFacade('moderna_ladrillo')).toBe('moderna_blanca')
  })

  it('el vano plegable ancho es un portón cerrado de 4 hojas, no una puerta batiente', () => {
    const s = buildScene(house(), undefined, { facade: true })
    expect(s.root.getObjectByName('door:gate')).toBeUndefined()
    expect(s.root.getObjectByName('gate:gate')!.children).toHaveLength(4)
  })

  it('con fachada la cubierta es losa plana con antepecho, sin teja', () => {
    const s = buildScene(house(), undefined, { facade: true, roof: true })
    const names = meshes(s.details).map((m) => m.name)
    expect(names).toContain('roof:lvl_0:slab')
    expect(names.some((n) => n.startsWith('parapet:w_top'))).toBe(true)
    expect(names.some((n) => n.startsWith('coping:'))).toBe(true)
    expect(names.some((n) => n.startsWith('gable:'))).toBe(false)
  })

  it('los marcos de fachada se parten: la mitad de afuera toma el color del estilo', () => {
    const s = buildScene(house(), undefined, { facade: true, details: true })
    const outer = meshes(s.details).filter((m) => m.name.startsWith('frame:o_win:') && m.name.endsWith(':out'))
    expect(outer).toHaveLength(4)
    expect(outer.every((m) => m.userData.kind === 'facade')).toBe(true)
    // la puerta interior (w_mid) conserva su marco entero
    expect(meshes(s.details).some((m) => m.name.startsWith('frame:o_door:') && m.name.endsWith(':out'))).toBe(false)
  })
})

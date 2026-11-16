import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { Furniture } from '@/api/types'
import { FurnitureFactory } from './FurnitureFactory'
import { clearInterioresModels, fitModel, interioresModelUrl, isInterioresItem, loadInterioresModel } from './interioresModels'
import { MaterialFactory } from './MaterialFactory'

/** Un «modelo» de 2 × 1 × 4 con el origen corrido, como llegan muchos GLB. */
const model = () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4))
  mesh.position.set(5, 3, -1)
  const root = new THREE.Group()
  root.add(mesh)
  return root
}

const sofa: Furniture = { id: 'int-sala-p1', catalog_id: 'int_sofa-3', position: { x: 4, y: 5 }, width: 2.2, depth: 0.9, height: 0.8, rotation: 0 }

describe('muebles de Interiores 3D en el visor', () => {
  it('reconoce las piezas de Interiores y sabe de dónde bajar su modelo', () => {
    expect(isInterioresItem('int_sofa-3')).toBe(true)
    expect(isInterioresItem('sofa_3')).toBe(false)
    expect(interioresModelUrl('int_sofa-3', 'https://interiores.test')).toBe('https://interiores.test/api/catalog/sofa-3/model.glb')
  })

  it('el modelo se encaja en la huella del mueble, apoyado en el piso', () => {
    const fitted = fitModel(model(), { width: 2.2, depth: 0.9, height: 0.8 }, { furnitureId: 'f1' })
    const box = new THREE.Box3().setFromObject(fitted)
    const size = box.getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(2.2)
    expect(size.y).toBeCloseTo(0.8)
    expect(size.z).toBeCloseTo(0.9)
    expect(box.min.y).toBeCloseTo(0)
    expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(0)
    fitted.traverse((o) => expect(o.userData.furnitureId).toBe('f1'))
  })

  it('cada pieza se baja una sola vez; si falla, null', async () => {
    clearInterioresModels()
    let calls = 0
    const loader = async () => {
      calls += 1
      return model()
    }
    await Promise.all([loadInterioresModel('int_a', loader), loadInterioresModel('int_a', loader)])
    expect(calls).toBe(1)
    expect(await loadInterioresModel('int_roto', async () => Promise.reject(new Error('404')))).toBeNull()
  })

  it('la fábrica pone la caja y la cambia por el modelo real cuando llega', async () => {
    let resolve!: (o: THREE.Object3D) => void
    const factory = new FurnitureFactory(new MaterialFactory(), () => new Promise((r) => (resolve = r)))
    const group = factory.create(sofa)
    expect(group.userData.source).toBe('interiores')
    expect(group.children).toHaveLength(1)
    const placeholder = group.children[0] as THREE.Mesh
    expect(placeholder.geometry).toBeInstanceOf(THREE.BoxGeometry)

    resolve(model())
    await new Promise((r) => setTimeout(r, 0))
    expect(group.children).toHaveLength(1)
    expect(group.children[0]).not.toBe(placeholder)
    const size = new THREE.Box3().setFromObject(group.children[0]!).getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(2.2)
  })

  it('las piezas propias de Plano 3D no piden nada a Interiores', () => {
    let asked = 0
    const factory = new FurnitureFactory(new MaterialFactory(), async () => {
      asked += 1
      return null
    })
    factory.create({ ...sofa, id: 'f2', catalog_id: 'sofa_3' })
    expect(asked).toBe(0)
  })
})

import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { sampleModel } from '@/test/fixtures'
import { MaterialFactory } from './MaterialFactory'
import { FLOOR_THICKNESS, SceneBuilder, buildScene, disposeScene } from './SceneBuilder'
import { exportGlb } from './exportGlb'

describe('SceneBuilder', () => {
  it('arma muros, pisos y vidrios a partir del modelo', () => {
    const s = buildScene(sampleModel())
    // 3 muros macizos + muro con ventana (solid, sill, lintel, solid) + muro con puerta (solid, lintel, solid)
    expect(s.walls.children).toHaveLength(3 + 4 + 3)
    expect(s.floors.children).toHaveLength(2)
    expect(s.glass.children).toHaveLength(1)
    disposeScene(s)
  })

  it('los pasos son opcionales y encadenables', () => {
    const s = new SceneBuilder(sampleModel()).withWalls().build()
    expect(s.floors.children).toHaveLength(0)
    expect(s.walls.children.length).toBeGreaterThan(0)
  })

  it('la caja de la escena coincide con la planta (10 × 7 m, 2.6 m de alto)', () => {
    const s = buildScene(sampleModel())
    s.root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(s.root)
    expect(box.min.x).toBeCloseTo(-0.1)
    expect(box.max.x).toBeCloseTo(10.1)
    expect(box.min.z).toBeCloseTo(-0.1)
    expect(box.max.z).toBeCloseTo(7.1)
    expect(box.max.y).toBeCloseTo(2.6)
    expect(box.min.y).toBeCloseTo(-FLOOR_THICKNESS)
  })

  it('el piso de cada ambiente cae sobre su polígono (no espejado)', () => {
    const s = buildScene(sampleModel())
    s.root.updateMatrixWorld(true)
    const floor = s.floors.children.find((c) => c.userData.roomId === 'r_b')!
    const box = new THREE.Box3().setFromObject(floor)
    expect(box.min.x).toBeCloseTo(6.1)
    expect(box.max.z).toBeCloseTo(6.9)
    expect(box.min.z).toBeCloseTo(0.1)
    expect(box.max.y).toBeCloseTo(0)
  })

  it('los muros guardan metadatos para seleccionarlos desde el 3D', () => {
    const s = buildScene(sampleModel())
    expect(s.walls.children[0]!.userData).toMatchObject({ kind: 'wall', levelId: 'lvl_0' })
  })
})

describe('MaterialFactory', () => {
  it('reutiliza instancias y elige piso por tipo de ambiente', () => {
    const f = new MaterialFactory()
    expect(f.wall()).toBe(f.wall('solid'))
    expect(f.floorFor('Cocina')).toBe(f.floorFor('cocina integrada'))
    expect(f.floorFor('Cocina')).not.toBe(f.floorFor('Dormitorio 1'))
    expect(f.floorFor('Espacio 3').color.getHexString()).toBe('bfae96')
    expect(f.glass().transparent).toBe(true)
    expect(f.highlight()).toBe(f.highlight())
    expect(f.ground()).toBeInstanceOf(THREE.MeshStandardMaterial)
    f.dispose()
  })
})

describe('exportGlb', () => {
  it('produce un GLB binario válido (cabecera glTF)', async () => {
    const s = new SceneBuilder(sampleModel()).withWalls().build()
    const blob = await exportGlb(s.root)
    const header = new Uint8Array(await blob.arrayBuffer()).slice(0, 4)
    expect(new TextDecoder().decode(header)).toBe('glTF')
  })
})

describe('SceneBuilder: elementos del modelo v2', () => {
  it('columnas, escaleras, puertas y muros curvos', () => {
    const m = sampleModel()
    const lv = m.levels[0]!
    lv.columns = [
      { id: 'c1', center: { x: 5, y: 3.5 }, width: 0.3, depth: 0.3, round: false, rotation: 0, confidence: 1 },
      { id: 'c2', center: { x: 2, y: 2 }, width: 0.4, depth: 0.4, round: true, rotation: 0, confidence: 1 },
    ]
    lv.stairs = [
      { id: 's1', start: { x: 6, y: 1 }, end: { x: 9, y: 1 }, width: 1, steps: 12, riser: 0.175, confidence: 1, base: 0 },
    ]
    lv.walls.push({
      id: 'curva',
      start: { x: 10, y: 1 },
      end: { x: 10, y: 4 },
      bulge: -1.2,
      thickness: 0.2,
      height: 2.6,
      material: 'plaster',
      openings: [],
      confidence: 1,
    })
    const s = buildScene(m)
    const kinds = s.elements.children.map((c) => c.userData.kind as string)
    expect(kinds.filter((k) => k === 'column')).toHaveLength(2)
    expect(kinds.filter((k) => k === 'stair')).toHaveLength(12)
    expect(kinds.filter((k) => k === 'door').length).toBeGreaterThanOrEqual(1)
    s.root.updateMatrixWorld(true)
    const curved = s.walls.children.filter((c) => c.userData.wallId === 'curva')
    expect(curved.length).toBeGreaterThan(5)
    const box = new THREE.Box3()
    for (const c of curved) box.expandByObject(c)
    expect(box.max.x).toBeGreaterThan(11) // el bow window sobresale
    disposeScene(s)
  })
})

describe('mobiliario y acabados en la escena', () => {
  const withFurniture = () => {
    const m = sampleModel()
    const lv = m.levels[0]!
    return {
      ...m,
      levels: [
        {
          ...lv,
          walls: lv.walls.map((w) => (w.id === 'w_top' ? { ...w, material: 'ladrillo' } : w)),
          rooms: lv.rooms.map((r) => (r.id === 'r_a' ? { ...r, floor_material: 'porcelanato' } : r)),
          furniture: [
            { id: 'f1', catalog_id: 'cama_doble', position: { x: 3, y: 3 }, width: 1.4, depth: 1.95, height: 1, rotation: Math.PI / 2 },
            { id: 'f2', catalog_id: 'pieza_futura', position: { x: 8, y: 5 }, width: 1, depth: 1, height: 0.5, rotation: 0 },
          ],
        },
      ],
    }
  }

  it('cada mueble es un grupo en su lugar, girado y seleccionable', () => {
    const s = buildScene(withFurniture())
    expect(s.furniture.children).toHaveLength(2)
    const bed = s.furniture.children[0]!
    expect(bed.position.x).toBe(3)
    expect(bed.position.z).toBe(3)
    expect(bed.rotation.y).toBeCloseTo(-Math.PI / 2)
    expect(bed.children.every((c) => c.userData.furnitureId === 'f1')).toBe(true)
    // pieza desconocida: su caja envolvente
    const unknown = s.furniture.children[1]!
    expect(unknown.children).toHaveLength(1)
    s.root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(unknown)
    expect(box.max.y).toBeCloseTo(0.5)
    disposeScene(s)
  })

  it('usa el acabado de cada muro y el piso elegido del ambiente', () => {
    const materials = new MaterialFactory()
    const s = new SceneBuilder(withFurniture(), materials).withWalls().withFloors().build()
    const brick = s.walls.children.find((c) => c.userData.wallId === 'w_top') as THREE.Mesh
    const plain = s.walls.children.find((c) => c.userData.wallId === 'w_right') as THREE.Mesh
    expect((brick.material as THREE.Material).name).toMatch(/^wall:ladrillo:/)
    expect((plain.material as THREE.Material).name).toMatch(/^wall:plaster:/)
    const floorA = s.floors.children.find((c) => c.userData.roomId === 'r_a') as THREE.Mesh
    expect((floorA.material as THREE.Material).name).toBe('floor:porcelanato')
    materials.dispose()
  })
})

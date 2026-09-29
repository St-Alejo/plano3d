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

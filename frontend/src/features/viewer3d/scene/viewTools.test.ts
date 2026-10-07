import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { modelBounds } from '@/domain/model'
import { sampleModel } from '@/test/fixtures'
import { buildScene, disposeScene } from './SceneBuilder'
import { applyDisplayMode, cameraPreset, distance3, exportObj } from './viewTools'

describe('encuadres de cámara', () => {
  const b = modelBounds(sampleModel())
  it('planta mira desde arriba al centro; frontal a la altura de los ojos', () => {
    const top = cameraPreset('top', b)
    expect(top.position[0]).toBeCloseTo(5)
    expect(top.position[1]).toBeGreaterThan(10)
    expect(top.target).toEqual([5, 0, 3.5])
    const front = cameraPreset('front', b)
    expect(front.position[1]).toBeCloseTo(1.6)
    expect(front.position[2]).toBeGreaterThan(b.maxY)
  })
})

describe('modos de visualización', () => {
  it('alámbrico y rayos X se aplican y se revierten exactamente', () => {
    const s = buildScene(sampleModel())
    const wall = s.walls.children[0] as THREE.Mesh
    const glass = s.glass.children[0] as THREE.Mesh
    const wm = wall.material as THREE.MeshStandardMaterial
    const gm = glass.material as THREE.MeshPhysicalMaterial
    const glassOpacity = gm.opacity
    applyDisplayMode(s.root, 'wire')
    expect(wm.wireframe).toBe(true)
    applyDisplayMode(s.root, 'xray')
    expect(wm.wireframe).toBe(false)
    expect(wm.transparent).toBe(true)
    expect(wm.opacity).toBeCloseTo(0.3)
    applyDisplayMode(s.root, 'material')
    expect(wm.transparent).toBe(false)
    expect(wm.opacity).toBe(1)
    expect(gm.transparent).toBe(true)
    expect(gm.opacity).toBe(glassOpacity)
    disposeScene(s)
  })
})

describe('exportación OBJ', () => {
  it('produce vértices y caras de la escena', async () => {
    const s = buildScene(sampleModel())
    const text = await (await exportObj(s.root)).text()
    expect(text).toMatch(/^v /m)
    expect(text).toMatch(/^f /m)
    disposeScene(s)
  })

  it('distancia 3D', () => {
    expect(distance3([0, 0, 0], [3, 4, 0])).toBe(5)
  })
})

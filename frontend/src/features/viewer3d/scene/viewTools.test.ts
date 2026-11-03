import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { modelBounds } from '@/domain/model'
import { sampleModel } from '@/test/fixtures'
import { buildScene, disposeScene } from './SceneBuilder'
import type { BuildingModel } from '@/api/types'
import opc3 from '@/test/opc3.json'
import { applyDisplayMode, buildingHeight, cameraPreset, distance3, exportObj, fitFraming } from './viewTools'

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

describe('encuadre inicial según la pantalla', () => {
  const model = opc3 as unknown as BuildingModel
  const b = modelBounds(model)
  const h = buildingHeight(model)

  /** ¿Las 8 esquinas de la caja del edificio caen dentro de la pantalla? */
  function fits(aspect: number) {
    const v = fitFraming(cameraPreset('iso', b), b, h, aspect)
    const cam = new THREE.PerspectiveCamera(55, aspect, 0.05, 500)
    cam.position.set(...v.position)
    cam.lookAt(...v.target)
    cam.updateMatrixWorld()
    const corners = [b.minX, b.maxX].flatMap((x) => [0, h].flatMap((y) => [b.minY, b.maxY].map((z) => new THREE.Vector3(x, y, z).project(cam))))
    return corners.every((p) => Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1)
  }

  it('en un celular vertical se aleja hasta ver la casa entera de tres pisos', () => {
    expect(h).toBeGreaterThan(7)
    expect(fits(375 / 812)).toBe(true)
    expect(fits(768 / 1024)).toBe(true)
    expect(fits(1280 / 800)).toBe(true)
  })

  it('en pantalla ancha no acerca más que el encuadre de siempre', () => {
    const iso = cameraPreset('iso', b)
    const wide = fitFraming(iso, b, h, 16 / 9)
    const phone = fitFraming(iso, b, h, 375 / 812)
    const dist = (v: typeof iso) => distance3(v.position, v.target)
    expect(dist(wide)).toBeGreaterThanOrEqual(distance3(iso.position, iso.target) - 1e-6)
    expect(dist(phone)).toBeGreaterThan(dist(wide))
  })
})

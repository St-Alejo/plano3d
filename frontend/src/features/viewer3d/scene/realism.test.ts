import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { sampleModel } from '@/test/fixtures'
import { MaterialFactory } from './MaterialFactory'
import { buildScene, disposeScene, exportRoot, SceneBuilder } from './SceneBuilder'
import { worldUv } from './uv'

/** Rango de U de una malla (en metros, tras worldUv). */
function uSpan(mesh: THREE.Mesh): number {
  const uv = mesh.geometry.getAttribute('uv')
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < uv.count; i++) {
    lo = Math.min(lo, uv.getX(i))
    hi = Math.max(hi, uv.getX(i))
  }
  return hi - lo
}

describe('UV en metros', () => {
  it('un muro de 8 m tiene ocho veces más textura que uno de 1 m', () => {
    const short = new THREE.Mesh(new THREE.BoxGeometry(1, 2.6, 0.15))
    const long = new THREE.Mesh(new THREE.BoxGeometry(8, 2.6, 0.15))
    worldUv(short)
    worldUv(long)
    expect(uSpan(long) / uSpan(short)).toBeCloseTo(8, 1)
  })

  it('los tramos de un mismo muro quedan continuos (la textura no salta en el dintel)', () => {
    const s = buildScene(sampleModel())
    const parts = s.walls.children.filter((c) => c.userData.wallId === 'w_top') as THREE.Mesh[]
    // en la cara de frente (normal +z), el macizo termina en U = 2 m y el antepecho arranca ahí
    const frontU = (m: THREE.Mesh) => {
      const uv = m.geometry.getAttribute('uv')
      const nor = m.geometry.getAttribute('normal')
      return Array.from({ length: uv.count }, (_, i) => i).filter((i) => nor.getZ(i) > 0.9).map((i) => uv.getX(i))
    }
    const solid = parts.find((p) => p.name.includes(':solid:'))!
    const sill = parts.find((p) => p.name.includes(':sill:'))!
    expect(Math.max(...frontU(solid))).toBeCloseTo(2)
    expect(Math.min(...frontU(sill))).toBeCloseTo(2)
    disposeScene(s)
  })
})

describe('materiales PBR', () => {
  it('sin texturas (por defecto) los materiales siguen siendo de color liso', () => {
    const f = new MaterialFactory()
    expect(f.textured).toBe(false)
    expect(f.wall('solid', 'ladrillo').map).toBeNull()
  })

  it('con texturas el ladrillo trae color, relieve y rugosidad a escala real', () => {
    const f = new MaterialFactory({ textures: true, base: '/' })
    const m = f.wall('solid', 'ladrillo')
    expect(m.map).not.toBeNull()
    expect(m.normalMap).not.toBeNull()
    expect(m.roughnessMap).not.toBeNull()
    expect(m.map!.repeat.x).toBeCloseTo(1 / 1.1)
    // el mismo mapa se comparte entre tramos y pinturas sobre pañete
    expect(f.wall('sill', 'plaster').map).toBe(f.wall('solid', 'pintura_verde').map)
    expect(f.floorFor('Cocina')).toBe(f.floor('porcelanato', 'x'))
    f.dispose()
  })
})

describe('detalles de presentación', () => {
  it('guardaescobas en cada tramo que toca el piso y marcos en cada vano', () => {
    const s = new SceneBuilder(sampleModel()).withSkirting().withFrames().build()
    const skirting = s.details.children.filter((c) => c.name.startsWith('skirting:'))
    // 3 muros enteros + w_top (2 macizos y el antepecho) + w_mid (2 macizos; la puerta no lleva)
    expect(skirting).toHaveLength(3 + 3 + 2)
    const frames = s.details.children.filter((c) => c.name.startsWith('frame:'))
    expect(frames.map((f) => f.name).sort()).toEqual(['frame:o_door', 'frame:o_win'])
    // ventana: 4 perfiles + alféizar; puerta: 2 jambas + cabezal
    expect(frames.find((f) => f.name === 'frame:o_win')!.children).toHaveLength(5)
    expect(frames.find((f) => f.name === 'frame:o_door')!.children).toHaveLength(3)
  })

  it('la cubierta corre por el lado largo, vuela el alero y arranca sobre los muros', () => {
    const s = new SceneBuilder(sampleModel()).withRoof().build()
    s.root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(s.details)
    // planta de 10 × 7: alero de 0,6 m a cada lado del largo
    expect(box.min.x).toBeCloseTo(-0.6, 1)
    expect(box.max.x).toBeCloseTo(10.6, 1)
    // cumbrera: 3,5 m × tan 22° ≈ 1,41 m sobre los muros de 2,6 m
    expect(box.max.y).toBeGreaterThan(2.6 + 1.3)
    expect(box.max.y).toBeLessThan(2.6 + 1.6)
  })

  it('el terreno se ve pero no se exporta', () => {
    const s = buildScene(sampleModel(), undefined, { site: true })
    expect(s.site.children.length).toBe(5)
    const copy = exportRoot(s)
    expect(copy.getObjectByName('site')).toBeUndefined()
    expect(s.root.getObjectByName('site')).toBeDefined()
    disposeScene(s)
  })

  it('sin opciones la escena es la de siempre (sin detalles ni terreno)', () => {
    const s = buildScene(sampleModel())
    expect(s.details.children).toHaveLength(0)
    expect(s.site.children).toHaveLength(0)
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { clearInterioresFinishes, interioresFloorId, interioresFloorLook, interioresFloorSet } from './interioresFinishes'
import { MaterialFactory } from './MaterialFactory'

afterEach(() => clearInterioresFinishes())

describe('pisos diseñados en Interiores', () => {
  it('reconoce el prefijo int_ y nada más', () => {
    expect(interioresFloorId('int_wood-walnut')).toBe('wood-walnut')
    expect(interioresFloorId('madera')).toBeNull()
    expect(interioresFloorId(null)).toBeNull()
  })

  it('sin texturas, el piso toma el color del acabado de Interiores', () => {
    const floor = new MaterialFactory().floor('int_wood-walnut', 'Sala')
    expect(`#${floor.color.getHexString()}`).toBe('#6b4a33')
    expect(floor.roughness).toBeCloseTo(0.65)
    // acabado propio (no está en la biblioteca): tono neutro, nunca falla
    expect(`#${new MaterialFactory().floor('int_custom-x1', 'Sala').color.getHexString()}`).toBe(interioresFloorLook('custom-x1').color)
  })

  it('el juego de texturas sale del manifiesto de Interiores (una sola descarga)', async () => {
    let calls = 0
    const fetcher = async () => {
      calls++
      return {
        sets: { wood_floor: { sizeM: 1.7, maps: { albedo: '/api/textures/wood_floor/albedo.a.webp', normal: '/n.webp', arm: '/arm.webp' } } },
        surfaces: { 'wood-walnut': 'wood_floor' },
      }
    }
    const set = await interioresFloorSet('wood-walnut', fetcher)
    expect(set).toMatchObject({ sizeM: 1.7, maps: { albedo: '/api/textures/wood_floor/albedo.a.webp' } })
    expect(set?.base).toMatch(/^http/)
    expect(await interioresFloorSet('stone-slate', fetcher)).toBeNull()
    expect(calls).toBe(1)
  })

  it('si Interiores no responde, el piso se queda con su color', async () => {
    expect(await interioresFloorSet('wood-oak', () => Promise.reject(new Error('sin red')))).toBeNull()
  })
})

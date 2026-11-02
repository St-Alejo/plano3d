import { describe, expect, it } from 'vitest'
import type { BuildingModel } from '@/api/types'
import { rect, sampleModel, wall } from '@/test/fixtures'
import { levelCamera, levelsAbove, levelSummaries } from './levels'

/** Dos pisos: el de arriba llega en desorden para probar que se ordenan por altura. */
function twoStoreys(): BuildingModel {
  const m = sampleModel()
  m.levels.unshift({
    id: 'lvl_1',
    name: 'Segundo piso',
    elevation: 2.7,
    height: 2.4,
    walls: [wall('u1', 0, 0, 4, 0), wall('u2', 4, 0, 4, 3), wall('u3', 4, 3, 0, 3), wall('u4', 0, 3, 0, 0)],
    rooms: [rect('r_u', 'Alcoba', 0, 0, 4, 3)],
  })
  return m
}

describe('levelSummaries', () => {
  it('ordena de abajo hacia arriba y numera desde 1', () => {
    const s = levelSummaries(twoStoreys())
    expect(s.map((l) => [l.id, l.number])).toEqual([
      ['lvl_0', 1],
      ['lvl_1', 2],
    ])
  })

  it('suma el área de los ambientes, cuenta ambientes y toma la caja de los muros', () => {
    const [, top] = levelSummaries(twoStoreys())
    expect(top!.area).toBeCloseTo(12)
    expect(top!.rooms).toBe(1)
    expect(top!.height).toBe(2.4)
    expect(top!.box).toEqual({ x0: 0, x1: 4, y0: 0, y1: 3 })
  })

  it('usa 2,5 m de entrepiso si el nivel no trae altura', () => {
    expect(levelSummaries(sampleModel())[0]!.height).toBe(2.5)
  })
})

describe('levelsAbove', () => {
  it('devuelve solo los pisos más altos que el elegido', () => {
    const m = twoStoreys()
    expect(levelsAbove(m, 'lvl_0')).toEqual(['lvl_1'])
    expect(levelsAbove(m, 'lvl_1')).toEqual([])
    expect(levelsAbove(m, 'no-existe')).toEqual([])
  })
})

describe('levelCamera', () => {
  it('mira al centro del piso a su altura y se aleja según su tamaño', () => {
    const [, top] = levelSummaries(twoStoreys())
    const cam = levelCamera(top!)!
    expect(cam.look).toEqual([2, 3.2, 1.5])
    expect(cam.pos[1]).toBeGreaterThan(cam.look[1])
  })
})

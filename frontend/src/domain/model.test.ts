import { describe, expect, it } from 'vitest'
import { door, rect, sampleModel, wall } from '@/test/fixtures'
import {
  modelBounds,
  moveWallEndpoint,
  pointAlong,
  polygonArea,
  polygonCentroid,
  projectOnWall,
  rescaleModel,
  totalArea,
  validateWall,
  wallLength,
} from './model'

describe('geometría básica', () => {
  it('calcula largo, punto intermedio y proyección', () => {
    const w = wall('w', 0, 0, 4, 0)
    expect(wallLength(w)).toBe(4)
    expect(pointAlong(w, 1)).toEqual({ x: 1, y: 0 })
    expect(projectOnWall(w, { x: 2, y: 0.5 })).toEqual({ offset: 2, distance: 0.5 })
    expect(projectOnWall(w, { x: -3, y: 0 }).offset).toBe(0)
  })

  it('área y centroide de polígonos (incluye degenerados)', () => {
    const r = rect('r', 'x', 0, 0, 4, 3)
    expect(polygonArea(r.polygon)).toBe(12)
    expect(polygonCentroid(r.polygon)).toEqual({ x: 2, y: 1.5 })
    const line = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]
    expect(polygonArea(line)).toBe(0)
    expect(polygonCentroid(line)).toEqual({ x: 1, y: 0 })
  })

  it('el área es invariante ante traslaciones (propiedad)', () => {
    for (let i = 0; i < 50; i++) {
      const [dx, dy, s] = [Math.random() * 100 - 50, Math.random() * 100 - 50, Math.random() * 20 + 0.5]
      const r = rect('r', 'x', dx, dy, dx + s, dy + s)
      expect(polygonArea(r.polygon)).toBeCloseTo(s * s, 6)
    }
  })

  it('total y límites del modelo', () => {
    const m = sampleModel()
    expect(totalArea(m)).toBeCloseTo(5.8 * 6.8 + 3.8 * 6.8, 6)
    const b = modelBounds(m)
    expect([b.minX, b.maxX, b.minY, b.maxY]).toEqual([0, 10, 0, 7])
    expect(b.size).toBe(10)
    expect(modelBounds({ ...m, levels: [] }).size).toBe(1)
  })
})

describe('validateWall (espejo de invariantes del backend)', () => {
  it('acepta un muro correcto', () => {
    expect(validateWall(wall('w', 0, 0, 4, 0, [door('d', 1)]))).toBeNull()
  })
  it.each([
    ['muro corto', wall('w', 0, 0, 0.01, 0)],
    ['abertura fuera', wall('w', 0, 0, 2, 0, [door('d', 1.5)])],
    ['abertura alta', { ...wall('w', 0, 0, 4, 0, [door('d', 1)]), height: 2 }],
    ['solapadas', wall('w', 0, 0, 4, 0, [door('a', 0.5), door('b', 1)])],
    ['grosor cero', { ...wall('w', 0, 0, 4, 0), thickness: 0 }],
  ])('rechaza %s', (_name, w) => {
    expect(validateWall(w)).not.toBeNull()
  })
})

describe('moveWallEndpoint', () => {
  it('mover el inicio conserva la posición absoluta de las aberturas', () => {
    const w = wall('w', 0, 0, 10, 0, [door('d', 5)])
    const moved = moveWallEndpoint(w, 'start', { x: 2, y: 0 })
    expect(moved.openings[0]!.offset).toBe(3)
    expect(moveWallEndpoint(w, 'end', { x: 8, y: 0 }).openings[0]!.offset).toBe(5)
  })
})

describe('rescaleModel', () => {
  it('escala la planta pero no las alturas', () => {
    const m = rescaleModel(sampleModel(), 2)
    const w = m.levels[0]!.walls[4]!
    expect(wallLength(w)).toBe(14)
    expect(w.height).toBe(2.6)
    expect(w.openings[0]!.width).toBeCloseTo(1.8)
    expect(totalArea(m)).toBeCloseTo(totalArea(sampleModel()) * 4, 6)
    expect(m.scale).toEqual({ meters_per_pixel: 0.04, source: 'calibrated', confidence: 1 })
  })
})

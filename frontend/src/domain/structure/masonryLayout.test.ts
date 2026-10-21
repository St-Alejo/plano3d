import { describe, expect, it } from 'vitest'
import type { BuildingModel, Wall } from '@/api/types'
import { door, sampleModel, wall, windowOp } from '@/test/fixtures'
import { BRICKS, brickPitch, courseHeight } from './bricks'
import { deriveStructure } from './derive'
import { masonryLayout } from './masonryLayout'

const single = (w: Wall): BuildingModel => ({ ...sampleModel(), levels: [{ id: 'l', name: 'p', elevation: 0, walls: [w], rooms: [] }] })

describe('ladrillo pieza por pieza', () => {
  it('ninguna pieza invade un vano ni su dintel', () => {
    const m = sampleModel()
    const s = deriveStructure(m)
    const bricks = masonryLayout(m, s)
    for (const w of m.levels[0]!.walls) {
      for (const o of w.openings) {
        const lintel = s.lintels.find((l) => l.wallId === w.id)!
        const top = lintel.bottom + lintel.height
        for (const b of bricks.filter((x) => x.wallId === w.id)) {
          const overlapsX = b.along + b.length / 2 > o.offset + 1e-6 && b.along - b.length / 2 < o.offset + o.width - 1e-6
          const overlapsY = b.bottom + b.height > o.sill + 1e-6 && b.bottom < top - 1e-6
          expect(overlapsX && overlapsY).toBe(false)
        }
      }
    }
  })

  it('las piezas quedan dentro de su paño (no se meten en las columnetas)', () => {
    const m = sampleModel()
    const s = deriveStructure(m)
    const panels = new Map(s.panels.map((p) => [p.id, p]))
    for (const b of masonryLayout(m, s)) {
      const p = panels.get(b.panelId)!
      expect(b.along - b.length / 2).toBeGreaterThanOrEqual(p.from - 1e-9)
      expect(b.along + b.length / 2).toBeLessThanOrEqual(p.to + 1e-9)
      expect(b.bottom + b.height).toBeLessThanOrEqual(p.top + 1e-9)
    }
  })

  it('trabado a soga: las juntas de una hilada caen a media pieza de las de la siguiente', () => {
    const m = single(wall('w', 0, 0, 6, 0))
    const bricks = masonryLayout(m, deriveStructure(m))
    const joints = (c: number) => bricks.filter((b) => b.course === c && !b.cut).map((b) => b.along - b.length / 2)
    const pitch = brickPitch(BRICKS.tolete)
    const shift = (((joints(1)[0]! - joints(0)[0]!) % pitch) + pitch) % pitch
    expect(shift).toBeCloseTo(pitch / 2, 3)
  })

  it('el número de piezas corresponde al área del muro (±3 %)', () => {
    const m = single(wall('w', 0, 0, 4, 0))
    const s = deriveStructure(m)
    const bricks = masonryLayout(m, s)
    const area = s.panels.reduce((a, p) => a + (p.to - p.from) * (p.top - p.bottom), 0)
    const u = BRICKS.tolete
    const covered = bricks.reduce((a, b) => a + (b.length + u.joint) * (b.height + u.joint), 0)
    expect(Math.abs(covered - area) / area).toBeLessThan(0.03)
    // del orden de 55 toletes por m²
    const whole = bricks.length / area
    expect(whole).toBeGreaterThan(50)
    expect(whole).toBeLessThan(65)
  })

  it('el bloque Nº5 lleva muchas menos piezas que el tolete', () => {
    const m = single(wall('w', 0, 0, 4, 0))
    const tolete = masonryLayout(m, deriveStructure(m)).length
    const bloque = masonryLayout(m, deriveStructure(m, { brick: 'bloque5' })).length
    expect(bloque).toBeLessThan(tolete / 4)
    // las hiladas del bloque son de 24 cm
    expect(courseHeight(BRICKS.bloque5)).toBeCloseTo(0.24)
  })

  it('con puerta y ventana se cortan piezas a los lados del vano', () => {
    const m = single(wall('w', 0, 0, 5, 0, [door('d', 0.8), windowOp('v', 3)]))
    const bricks = masonryLayout(m, deriveStructure(m))
    expect(bricks.some((b) => b.cut)).toBe(true)
    // bajo la ventana (antepecho) sí hay ladrillo; en el vano de la puerta, no
    expect(bricks.some((b) => b.along > 3 && b.along < 4.2 && b.bottom < 0.9)).toBe(true)
    expect(bricks.some((b) => b.along > 0.85 && b.along < 1.65 && b.bottom < 2)).toBe(false)
  })
})

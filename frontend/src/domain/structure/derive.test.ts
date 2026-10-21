import { describe, expect, it } from 'vitest'
import type { BuildingModel, Level, Wall } from '@/api/types'
import { door, sampleModel, wall, windowOp } from '@/test/fixtures'
import { distance, projectOnWall, wallLength } from '../model'
import { deriveStructure, isConfined } from './derive'
import { columnDepth, NSR10 } from './nsr10'

const model = (walls: Wall[], extra: Partial<Level> = {}): BuildingModel => ({
  ...sampleModel(),
  levels: [{ id: 'l0', name: 'Piso 1', elevation: 0, walls, rooms: [], ...extra }],
})

const colsOn = (w: Wall, s: ReturnType<typeof deriveStructure>) =>
  s.columns
    .map((c) => projectOnWall(w, c.center))
    .filter((p) => p.distance < 0.15 && p.offset > -0.1 && p.offset < wallLength(w) + 0.1)
    .map((p) => p.offset)
    .sort((a, b) => a - b)

describe('columnetas (NSR-10 E.4.3)', () => {
  it('van en las cuatro esquinas y en las uniones en T', () => {
    const s = deriveStructure(sampleModel())
    for (const p of [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 7 }, { x: 0, y: 7 }]) {
      expect(s.columns.find((c) => distance(c.center, p) < 0.01)?.reason).toBe('esquina')
    }
    for (const p of [{ x: 6, y: 0 }, { x: 6, y: 7 }]) {
      expect(s.columns.some((c) => distance(c.center, p) < 0.01)).toBe(true)
    }
  })

  it('ninguna supera la separación máxima ni cae dentro de un vano', () => {
    const m = sampleModel()
    const s = deriveStructure(m)
    for (const w of m.levels[0]!.walls) {
      const at = colsOn(w, s)
      const max = NSR10.maxColumnSpacing(w.thickness, w.height - NSR10.beamHeight)
      at.slice(1).forEach((x, i) => expect(x - at[i]!).toBeLessThanOrEqual(max + columnDepth(w.thickness) + 1e-6))
      for (const o of w.openings) for (const x of at) expect(x <= o.offset || x >= o.offset + o.width).toBe(true)
    }
    // dos columnetas nunca se tocan
    s.columns.forEach((a, i) => s.columns.slice(i + 1).forEach((b) => expect(distance(a.center, b.center)).toBeGreaterThan(0.15)))
  })

  it('un muro suelto de 9 m lleva dos intermedias, cada 3 m', () => {
    const s = deriveStructure(model([{ ...wall('w', 0, 0, 9, 0), thickness: 0.15 }]))
    expect(s.columns.map((c) => c.center.x).sort((a, b) => a - b)).toEqual([0, 3, 6, 9])
    expect(s.columns.filter((c) => c.reason === 'separación')).toHaveLength(2)
    expect(s.columns.filter((c) => c.reason === 'extremo')).toHaveLength(2)
  })

  it('un vano grande (puerta de 1,89 m²) lleva una columneta a cada lado', () => {
    const w = wall('w', 0, 0, 3, 0, [door('d', 1)])
    const s = deriveStructure(model([w]))
    const at = colsOn(w, s)
    const d = columnDepth(0.2)
    expect(at).toContain(1 - d / 2)
    expect(at.some((x) => Math.abs(x - (1.9 + d / 2)) < 1e-9)).toBe(true)
    expect(s.columns.filter((c) => c.reason === 'vano')).toHaveLength(2)
  })

  it('una ventana chica no pide columnetas propias', () => {
    const s = deriveStructure(model([wall('w', 0, 0, 3, 0, [windowOp('v', 1, 1)])]))
    expect(s.columns.filter((c) => c.reason === 'vano')).toHaveLength(0)
  })

  it('la sección tiene el grosor del muro y al menos 200 cm²', () => {
    for (const t of [0.1, 0.12, 0.15, 0.2, 0.25]) {
      expect(columnDepth(t) * t).toBeGreaterThanOrEqual(NSR10.minConfinementArea - 1e-9)
      expect(columnDepth(t)).toBeGreaterThanOrEqual(t)
    }
    expect(columnDepth(0.12)).toBeCloseTo(0.2)
  })

  it('una columna dibujada en el plano reemplaza a la derivada cercana', () => {
    const m = model(sampleModel().levels[0]!.walls, { columns: [{ id: 'k', center: { x: 0.1, y: 0.1 }, width: 0.3, depth: 0.3, rotation: 0, round: false, confidence: 1 }] })
    const s = deriveStructure(m)
    const c = s.columns.find((x) => x.source === 'model')!
    expect(c.along).toBe(0.3)
    expect(s.columns.filter((x) => distance(x.center, { x: 0, y: 0 }) < 0.35)).toHaveLength(1)
  })
})

describe('tabiques', () => {
  it('un tabique no se confina: sin columnetas propias, sin viga ni cimiento, un solo paño', () => {
    const m = sampleModel()
    m.levels[0]!.walls = m.levels[0]!.walls.map((w) => (w.id === 'w_mid' ? { ...w, kind: 'partition' as const } : w))
    const s = deriveStructure(m)
    expect(isConfined(m.levels[0]!.walls.find((w) => w.id === 'w_mid')!)).toBe(false)
    expect(s.columns.some((c) => distance(c.center, { x: 6, y: 0 }) < 0.01)).toBe(false)
    expect(s.beams.some((b) => b.wallId === 'w_mid')).toBe(false)
    expect(s.footings.some((b) => b.wallId === 'w_mid')).toBe(false)
    expect(s.panels.filter((p) => p.wallId === 'w_mid')).toEqual([expect.objectContaining({ confined: false, from: 0, to: 7 })])
  })

  it('marcado como estructural, un tabique sí se confina', () => {
    const w = { ...wall('w', 0, 0, 3, 0), kind: 'partition' as const, structural: true }
    expect(isConfined(w)).toBe(true)
  })
})

describe('vigas, cimientos y paños', () => {
  it('cada muro confinado tiene viga de amarre arriba y cimiento abajo', () => {
    const m = sampleModel()
    const s = deriveStructure(m)
    expect(s.beams).toHaveLength(5)
    expect(s.footings).toHaveLength(5)
    expect(s.plinths).toHaveLength(5)
    const top = s.beams.find((b) => b.wallId === 'w_top')!
    expect(top.bottom + top.height).toBeCloseTo(2.6)
    // el sobrecimiento llega justo al piso terminado y se apoya en la viga de cimentación
    const sc = s.plinths.find((b) => b.wallId === 'w_top')!
    const vc = s.footings.find((b) => b.wallId === 'w_top')!
    expect(sc.bottom + sc.height).toBeCloseTo(0)
    expect(vc.bottom + vc.height).toBeCloseTo(sc.bottom)
    expect(vc.bottom).toBeCloseTo(-NSR10.foundationDepth + NSR10.leanConcrete)
  })

  it('con dos pisos la viga de cimentación crece (0,30 × 0,30 con Nº4)', () => {
    const one = deriveStructure(sampleModel())
    const m = sampleModel()
    m.levels.push({ ...m.levels[0]!, id: 'l1', elevation: 2.75 })
    const two = deriveStructure(m)
    expect(one.footings[0]!.width).toBe(0.25)
    expect(two.footings[0]!.width).toBe(0.3)
    expect(two.footings[0]!.rebar!.bars.no).toBe(4)
    // el segundo piso tiene vigas pero no cimientos; sus columnetas arrancan en su piso
    expect(two.beams.filter((b) => b.levelId === 'l1')).toHaveLength(5)
    expect(two.footings.every((f) => f.levelId === 'lvl_0')).toBe(true)
    expect(Math.min(...two.columns.filter((c) => c.levelId === 'l1').map((c) => c.bottom))).toBeCloseTo(2.75)
  })

  it('los paños más las columnetas cubren el muro entero', () => {
    const m = sampleModel()
    const s = deriveStructure(m)
    const w = m.levels[0]!.walls.find((x) => x.id === 'w_right')!
    const panels = s.panels.filter((p) => p.wallId === w.id)
    const masonry = panels.reduce((acc, p) => acc + (p.to - p.from), 0)
    const cols = colsOn(w, s).length
    // cada esquina se come medio largo de columneta sobre este muro
    expect(masonry).toBeCloseTo(wallLength(w) - (cols - 1) * columnDepth(0.2), 5)
    for (const p of panels) expect(p.top).toBeCloseTo(2.6 - NSR10.beamHeight)
  })

  it('dinteles sobre la puerta y la ventana, con 20 cm de apoyo', () => {
    const s = deriveStructure(sampleModel())
    expect(s.lintels).toHaveLength(2)
    const d = s.lintels.find((l) => l.wallId === 'w_mid')!
    expect(distance(d.start, d.end)).toBeCloseTo(0.9 + 2 * NSR10.lintelBearing)
    expect(d.bottom).toBeCloseTo(2.1)
  })
})

describe('numeración y avisos', () => {
  it('ids estables y correlativos', () => {
    const a = deriveStructure(sampleModel())
    const b = deriveStructure(sampleModel())
    expect(a.columns.map((c) => c.id)).toEqual(b.columns.map((c) => c.id))
    expect(a.columns.map((c) => c.id)).toEqual(a.columns.map((_, i) => `C-${i + 1}`))
    expect(a.beams.map((x) => x.id)).toEqual(a.beams.map((_, i) => `VA-${i + 1}`))
  })

  it('avisa si hay más de dos pisos o muros curvos', () => {
    const m = sampleModel()
    m.levels.push({ ...m.levels[0]!, id: 'l1', elevation: 2.75 }, { ...m.levels[0]!, id: 'l2', elevation: 5.5 })
    m.levels[0]!.walls[0] = { ...m.levels[0]!.walls[0]!, bulge: 0.3 }
    const s = deriveStructure(m)
    expect(s.warnings.some((x) => x.includes('3 pisos'))).toBe(true)
    expect(s.warnings.some((x) => x.includes('curvo'))).toBe(true)
  })
})

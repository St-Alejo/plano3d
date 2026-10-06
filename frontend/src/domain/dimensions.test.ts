import { describe, expect, it } from 'vitest'
import type { Dimension } from '@/api/types'
import { sampleModel, wall } from '@/test/fixtures'
import { CommandError, ReplaceModel, SetDimensionValue } from './commands'
import { enclosedSpaces } from './rooms'
import { polygonArea } from './model'
import { dimensionLine } from '@/features/editor2d/PlanElements'

function dim(over: Partial<Dimension> = {}): Dimension {
  return {
    id: 'd1',
    a: { x: 0, y: 0 },
    b: { x: 5, y: 0.3 },
    value: 5,
    text: '5,00',
    axis: 'horizontal',
    offset: -0.8,
    source: 'dimension',
    status: 'inferred',
    confidence: 0.7,
    residual: null,
    wall_ids: [],
    ...over,
  }
}

describe('cotas en el editor', () => {
  it('corregir el valor de una cota es un comando reversible', () => {
    const m = sampleModel()
    m.levels[0]!.dimensions = [dim()]
    const cmd = new SetDimensionValue(m.levels[0]!.id, 'd1', 5.25)
    const next = cmd.execute(m)
    const d = next.levels[0]!.dimensions![0]!
    expect(d.value).toBe(5.25)
    expect(d.text).toBe('5,25')
    expect(d.source).toBe('manual')
    expect(cmd.undo(next).levels[0]!.dimensions![0]!.value).toBe(5)
    expect(() => new SetDimensionValue('lvl', 'd1', 0)).toThrow(CommandError)
  })

  it('el ajuste a cotas reemplaza el modelo y se puede deshacer', () => {
    const before = sampleModel()
    const after = sampleModel()
    after.levels[0]!.walls = []
    const cmd = new ReplaceModel(after)
    expect(cmd.execute(before)).toBe(after)
    expect(cmd.undo(after)).toBe(before)
  })

  it('la línea de cota horizontal se proyecta y se desplaza', () => {
    const { a, b } = dimensionLine(dim())
    expect(a.y).toBeCloseTo(b.y)
    expect(Math.abs(b.x - a.x)).toBeCloseTo(5)
    expect(Math.abs(a.y)).toBeCloseTo(0.8)
  })
})

describe('ambientes con muros curvos', () => {
  it('el muro curvo cierra el ambiente y agrega el área del arco', () => {
    const t = 0.2
    const walls = [
      wall('top', 0, 0, 4, 0),
      wall('bottom', 4, 3, 0, 3),
      wall('left', 0, 3, 0, 0),
      { ...wall('arc', 4, 0, 4, 3), bulge: -1 }, // sobresale 1 m hacia +x
    ]
    const spaces = enclosedSpaces(walls)
    expect(spaces).toHaveLength(1)
    const area = polygonArea(spaces[0]!)
    // rectángulo interior (4 - t) x (3 - t) más el segmento circular (~2,1 m²) menos la mitad del muro curvo
    expect(area).toBeGreaterThan((4 - t) * (3 - t) + 1.5)
    expect(area).toBeLessThan((4 - t) * (3 - t) + 2.4)
  })
})

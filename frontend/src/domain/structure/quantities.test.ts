import { describe, expect, it } from 'vitest'
import type { BuildingModel, Wall } from '@/api/types'
import { sampleModel, wall } from '@/test/fixtures'
import { BRICKS } from './bricks'
import { deriveStructure } from './derive'
import { masonryLayout } from './masonryLayout'
import { barWeight, rebarSchedule } from './rebar'
import { buyAmount, DEFAULT_WASTE, MIXES, quantities, quantitiesCsv, quantityTotals, type QuantityLine } from './quantities'
import { STEP } from './schedule'

const single = (w: Wall): BuildingModel => ({ ...sampleModel(), levels: [{ id: 'l', name: 'Primer piso', elevation: 0, walls: [w], rooms: [] }] })

const sum = (lines: QuantityLine[], test: (l: QuantityLine) => boolean) => lines.filter(test).reduce((a, l) => a + l.amount, 0)

describe('cantidades de obra', () => {
  const m = single(wall('w', 0, 0, 3, 0))
  const s = deriveStructure(m)
  const bricks = masonryLayout(m, s)
  const lines = quantities(m, s, bricks)

  it('ladrillos: las piezas del despiece más el 5 % de desperdicio', () => {
    expect(sum(lines, (l) => l.item === BRICKS.tolete.name)).toBe(Math.ceil(bricks.length * 1.05))
  })

  it('mortero de pega: del orden de 0,02–0,04 m³ por m² de muro de 15 cm en tolete', () => {
    const area = s.panels.reduce((a, p) => a + (p.to - p.from) * (p.top - p.bottom), 0)
    const mortar = sum(lines, (l) => l.item === 'Mortero de pega') / (1 + DEFAULT_WASTE.mortar)
    expect(mortar / area).toBeGreaterThan(0.02)
    expect(mortar / area).toBeLessThan(0.04)
  })

  it('una columneta: volumen a mano y sus bultos de cemento', () => {
    const cols = s.columns
    const v = cols.reduce((a, c) => a + c.along * c.across * c.height, 0) * 1.05
    const step = STEP.columnas('l')
    expect(sum(lines, (l) => l.step === step && l.unit === 'm³' && l.item.startsWith('Concreto'))).toBeCloseTo(v, 6)
    expect(sum(lines, (l) => l.step === step && l.unit === 'bultos')).toBeCloseTo(v * MIXES.concrete.cement, 6)
    // formaleta solo en las dos caras del muro
    expect(sum(lines, (l) => l.step === step && l.unit === 'm²')).toBeCloseTo(cols.reduce((a, c) => a + 2 * c.along * c.height, 0), 6)
  })

  it('el acero es el del despiece más el 3 %, con alambre aparte', () => {
    const kg = rebarSchedule(s).reduce((a, b) => a + barWeight(b), 0)
    expect(sum(lines, (l) => l.item.startsWith('Acero'))).toBeCloseTo(kg * (1 + DEFAULT_WASTE.steel), 6)
    expect(sum(lines, (l) => l.item.startsWith('Alambre'))).toBeCloseTo(kg * 0.02, 6)
  })

  it('cada línea pertenece a un paso de la secuencia', () => {
    const steps = new Set(lines.map((l) => l.step))
    expect(steps.has(STEP.cimentacion)).toBe(true)
    expect(steps.has(STEP.muros('l'))).toBe(true)
    expect(lines.every((l) => l.amount > 0)).toBe(true)
  })

  it('totales: un renglón por material; bultos y unidades se compran enteros', () => {
    const totals = quantityTotals(lines)
    expect(new Set(totals.map((t) => `${t.item}|${t.unit}`)).size).toBe(totals.length)
    const arena = totals.find((t) => t.item === 'Arena')!
    expect(arena.amount).toBeCloseTo(sum(lines, (l) => l.item === 'Arena'), 9)
    expect(buyAmount({ step: '', item: 'x', unit: 'bultos', amount: 7.01 })).toBe(8)
    expect(buyAmount({ step: '', item: 'x', unit: 'm³', amount: 0.42 })).toBe(0.42)
  })

  it('una casa: la placa y el sobrecimiento aparecen; CSV con etapa y total', () => {
    const house = sampleModel()
    const hs = deriveStructure(house)
    const hl = quantities(house, hs, masonryLayout(house, hs))
    expect(sum(hl, (l) => l.step === STEP.placa && l.unit === 'm³')).toBeGreaterThan(0)
    expect(sum(hl, (l) => l.item === 'Piedra rajón')).toBeGreaterThan(0)
    const text = quantitiesCsv(hl, (id) => `Paso ${id}`)
    const rows = text.slice(1).trim().split('\r\n')
    expect(rows[0]).toBe('Etapa;Material;Unidad;Cantidad')
    expect(rows.at(-1)).toMatch(/^Total obra;/)
  })
})

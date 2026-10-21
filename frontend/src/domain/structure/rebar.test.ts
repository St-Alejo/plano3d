import { describe, expect, it } from 'vitest'
import { sampleModel, wall } from '@/test/fixtures'
import { deriveStructure } from './derive'
import { BARS, NSR10 } from './nsr10'
import { barWeight, rebarCsv, rebarSchedule, steelByDiameter, stirrupCount, stirrupPositions } from './rebar'

describe('estribos', () => {
  it('a 10 cm en los 45 cm de cada nudo y a 20 cm en el centro', () => {
    // 2,0 m: 5 + 5 en las zonas de nudo, 1,1 m / 0,2 → 6 en el centro, y el de cierre
    expect(stirrupCount(2, NSR10.columnRebar.stirrups)).toBe(17)
  })

  it('separación uniforme cuando no hay zona de nudo', () => {
    expect(stirrupCount(1, { no: 2, spacing: 0.2 })).toBe(6)
    expect(stirrupCount(0, { no: 2, spacing: 0.2 })).toBe(0)
  })
})

describe('despiece', () => {
  const s = deriveStructure(sampleModel())
  const bars = rebarSchedule(s)

  it('cada elemento con refuerzo trae sus barras longitudinales y sus estribos', () => {
    for (const e of [...s.footings, ...s.columns, ...s.beams, ...s.lintels]) {
      expect(bars.some((b) => b.mark === `${e.id}-L`)).toBe(true)
      expect(bars.some((b) => b.mark === `${e.id}-E`)).toBe(true)
    }
    // los sobrecimientos van en concreto ciclópeo, sin acero
    expect(bars.some((b) => b.elementId.startsWith('SC-'))).toBe(false)
  })

  it('una columneta: 4 Nº3 con ganchos de 90° que rematan en la viga de amarre', () => {
    const c = s.columns[0]!
    const l = bars.find((b) => b.mark === `${c.id}-L`)!
    const hook = 12 * BARS[3].db
    expect(l.count).toBe(4)
    expect(l.shape).toBe('L')
    expect(l.cutLength).toBeCloseTo(c.height + NSR10.beamHeight - NSR10.cover.column + 2 * hook)
  })

  it('el estribo rodea la sección menos el recubrimiento, con dos ganchos de 135°', () => {
    const c = s.columns[0]!
    const e = bars.find((b) => b.mark === `${c.id}-E`)!
    const inner = 2 * (c.across - 0.06 + c.along - 0.06)
    expect(e.cutLength).toBeCloseTo(inner + 2 * 0.075)
    expect(e.shape).toBe('estribo')
  })

  it('una viga de más de 6 m se arma con varillas traslapadas', () => {
    const st = deriveStructure({ ...sampleModel(), levels: [{ id: 'l', name: 'p', elevation: 0, walls: [wall('w', 0, 0, 10, 0)], rooms: [] }] })
    const l = rebarSchedule(st).find((b) => b.mark === `${st.beams[0]!.id}-L`)!
    expect(l.cutLength).toBeLessThanOrEqual(NSR10.barStock)
    expect(l.count).toBe(8) // 4 barras × 2 tramos
  })

  it('el peso total es la suma de largo × cantidad × kg/m', () => {
    const total = bars.reduce((acc, b) => acc + b.cutLength * b.count * BARS[b.no].kgPerM, 0)
    const byDia = [...steelByDiameter(bars).values()].reduce((a, b) => a + b, 0)
    expect(byDia).toBeCloseTo(total)
    expect(bars.map(barWeight).reduce((a, b) => a + b, 0)).toBeCloseTo(total)
    // una casa de 70 m² en un piso lleva del orden de cientos de kilos, no toneladas
    expect(total).toBeGreaterThan(150)
    expect(total).toBeLessThan(1500)
  })
})

describe('posición de los estribos', () => {
  it('tantos como el despiece, en orden, densos junto a los nudos', () => {
    const s = NSR10.columnRebar.stirrups
    for (const len of [0.6, 1, 2, 2.7, 4.3]) {
      const p = stirrupPositions(len, s)
      expect(p).toHaveLength(stirrupCount(len, s))
      expect(p[0]).toBe(0)
      expect(p.at(-1)).toBeCloseTo(len)
      for (let i = 1; i < p.length; i++) expect(p[i]! - p[i - 1]!).toBeGreaterThan(0)
      // ninguna separación pasa de la general; junto al nudo, de la de nudo
      for (let i = 1; i < p.length; i++) expect(p[i]! - p[i - 1]!).toBeLessThanOrEqual(s.spacing + 1e-9)
      expect(p[1]! - p[0]!).toBeLessThanOrEqual(s.nodeSpacing! + 1e-9)
    }
  })
})

describe('cartilla en CSV', () => {
  const bars = rebarSchedule(deriveStructure(sampleModel()))
  const text = rebarCsv(bars)
  const BOM = String.fromCharCode(0xfeff)
  const rows = text.slice(BOM.length).trim().split('\r\n')

  it('BOM, punto y coma, una fila por marca y los totales por diámetro', () => {
    expect(text.startsWith(BOM)).toBe(true)
    expect(rows[0]).toBe('Marca;Elemento;Barra;Forma;Tramos (m);Cantidad;Largo de corte (m);Largo total (m);Peso (kg)')
    const diameters = steelByDiameter(bars).size
    expect(rows).toHaveLength(1 + bars.length + diameters)
    expect(rows.at(-1)).toMatch(/^Total;;Nº\d/)
  })

  it('coma decimal: Excel en español lo lee como número', () => {
    const first = rows[1]!.split(';')
    expect(first[6]).toMatch(/^\d+,\d{2}$/)
  })
})

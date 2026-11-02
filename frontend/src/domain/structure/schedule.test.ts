import { describe, expect, it } from 'vitest'
import type { BuildingModel } from '@/api/types'
import { sampleModel } from '@/test/fixtures'
import { deriveStructure } from './derive'
import { masonryLayout } from './masonryLayout'
import { constructionSchedule, STEP, stageOf, stagesOf } from './schedule'

/** Casa de dos pisos: el segundo copia el primero con ids propios. */
function twoStories(): BuildingModel {
  const m = sampleModel()
  const ground = m.levels[0]!
  m.levels.push({ ...ground, id: 'l1', name: 'Segundo piso', elevation: 2.75, walls: ground.walls.map((w) => ({ ...w, id: `${w.id}-2` })), rooms: [] })
  return m
}

const scheduleOf = (m: BuildingModel) => {
  const s = deriveStructure(m)
  return constructionSchedule(m, s, masonryLayout(m, s))
}

describe('secuencia constructiva', () => {
  it('nada se construye sobre algo que aún no existe', () => {
    const m = twoStories()
    const ids = scheduleOf(m).map((s) => s.id)
    const at = (id: string) => {
      const i = ids.indexOf(id)
      expect(i, id).toBeGreaterThanOrEqual(0)
      return i
    }
    const [l0, l1] = m.levels.map((l) => l.id) as [string, string]
    const chain = [
      STEP.terreno,
      STEP.solado,
      STEP.aceroCimentacion,
      STEP.cimentacion,
      STEP.sobrecimiento,
      STEP.placa,
      STEP.muros(l0),
      STEP.aceroColumnas(l0),
      STEP.columnas(l0),
      STEP.aceroVigas(l0),
      STEP.vigas(l0),
      STEP.losa(l1),
      STEP.muros(l1),
      STEP.columnas(l1),
      STEP.vigas(l1),
    ]
    for (let i = 1; i < chain.length; i++) expect(at(chain[i - 1]!), `${chain[i - 1]} antes de ${chain[i]}`).toBeLessThan(at(chain[i]!))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('un piso: sin losa de entrepiso; los muros dicen hiladas y ladrillos', () => {
    const steps = scheduleOf(sampleModel())
    expect(steps.some((s) => s.id.startsWith('losa:'))).toBe(false)
    const walls = steps.find((s) => s.id.startsWith('muros:'))!
    expect(walls.detail).toMatch(/\d+ hiladas, [\d.]+ ladrillos/)
    expect(steps.find((s) => s.id === STEP.aceroCimentacion)!.detail).toMatch(/\d+,\d kg/)
  })
})

describe('etapas de la obra', () => {
  it('clasifica cada paso por su prefijo', () => {
    expect(stageOf(STEP.terreno)).toBe('cimentacion')
    expect(stageOf(STEP.sobrecimiento)).toBe('cimentacion')
    expect(stageOf(STEP.placa)).toBe('placas')
    expect(stageOf(STEP.losa('l1'))).toBe('placas')
    expect(stageOf(STEP.muros('l1'))).toBe('muros')
    expect(stageOf(STEP.aceroVigas('l1'))).toBe('confinamiento')
  })

  it('agrupa pasos seguidos en tramos que cubren toda la secuencia, repetidos por piso', () => {
    const steps = scheduleOf(twoStories())
    const stages = stagesOf(steps)
    expect(stages[0]).toMatchObject({ id: 'cimentacion', from: 0 })
    expect(stages[stages.length - 1]!.to).toBe(steps.length)
    // sin huecos ni solapes
    stages.slice(1).forEach((s, i) => expect(s.from).toBe(stages[i]!.to))
    expect(stages.filter((s) => s.id === 'muros')).toHaveLength(2)
  })
})

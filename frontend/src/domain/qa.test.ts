import { describe, expect, it } from 'vitest'
import type { BuildingModel } from '@/api/types'
import { door, sampleModel, wall } from '@/test/fixtures'
import { modelQA } from './qa'

const withLevel = (patch: Partial<BuildingModel['levels'][number]>, scale: BuildingModel['scale']['source'] = 'calibrated'): BuildingModel => {
  const m = sampleModel()
  return { ...m, scale: { ...m.scale, source: scale }, levels: [{ ...m.levels[0]!, ...patch }] }
}
const codes = (m: BuildingModel) => modelQA(m).map((i) => i.code)

describe('control de calidad del modelo', () => {
  it('el modelo de ejemplo solo avisa escala estimada, ambiente dudoso y sin nombre', () => {
    expect(codes(sampleModel())).toEqual(['low-confidence', 'scale'])
    const calibrated = { ...sampleModel(), scale: { meters_per_pixel: 0.02, source: 'calibrated' as const, confidence: 1 } }
    expect(codes(calibrated)).toEqual(['low-confidence'])
  })

  it('detecta muros duplicados superpuestos (error primero)', () => {
    const m = sampleModel()
    const issues = modelQA(withLevel({ walls: [...m.levels[0]!.walls, wall('dup', 2, 0, 8, 0)] }))
    expect(issues[0]).toMatchObject({ code: 'overlap', severity: 'error', target: { kind: 'wall', id: 'dup' } })
    expect(issues[0]!.message).toContain('6.00 m')
  })

  it('detecta muros sueltos (T y esquinas cuentan como unidos)', () => {
    const m = sampleModel()
    expect(codes(withLevel({ walls: m.levels[0]!.walls }))).not.toContain('dangling')
    const loose = modelQA(withLevel({ walls: [...m.levels[0]!.walls, wall('isla', 2, 2, 4, 2)] }))
    expect(loose.find((i) => i.code === 'dangling')).toMatchObject({ message: 'Muro suelto: no toca ningún otro', target: { id: 'isla' } })
    const half = modelQA(withLevel({ walls: [...m.levels[0]!.walls, wall('medio', 0, 2, 3, 2)] }))
    expect(half.find((i) => i.code === 'dangling')!.message).toBe('Muro con un extremo suelto')
  })

  it('detecta aberturas pegadas a una esquina y muros más cortos que su grosor', () => {
    const m = sampleModel()
    const walls = m.levels[0]!.walls.map((w) => (w.id === 'w_right' ? { ...w, openings: [door('pegada', 0)] } : w))
    expect(codes(withLevel({ walls: [...walls, wall('mini', 0, 0, 0.1, 0)] }))).toEqual(expect.arrayContaining(['opening-at-corner', 'short-wall']))
  })

  it('avisa si los muros no encierran ningún ambiente y marca ambientes sin nombre', () => {
    expect(codes(withLevel({ rooms: [] }))).toContain('no-rooms')
    const m = sampleModel()
    const rooms = m.levels[0]!.rooms.map((r) => ({ ...r, confidence: 0.9 }))
    expect(modelQA(withLevel({ rooms })).filter((i) => i.code === 'unnamed').map((i) => i.target)).toEqual([{ kind: 'room', id: 'r_b' }])
  })
})

describe('revisión con el modelo v2', () => {
  it('una escala de CAD o de cotas no se marca como estimada', () => {
    for (const source of ['vector', 'dimensions'] as const) {
      const m = sampleModel()
      m.scale = { ...m.scale, source }
      expect(modelQA(m).some((i) => i.code === 'scale')).toBe(false)
    }
  })
})

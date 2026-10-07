import { describe, expect, it } from 'vitest'
import { rect } from '@/test/fixtures'
import type { Level } from '@/api/types'
import { areaCsv, areaSchedule, perimeter } from './areas'

const level: Level = {
  id: 'l',
  name: 'P1',
  elevation: 0,
  walls: [],
  rooms: [{ ...rect('a', 'Sala; comedor', 0, 0, 4, 5), room_type: 'living' }, rect('b', 'Baño', 4, 0, 6, 2)],
}

describe('cuadro de áreas', () => {
  it('ordena por área y calcula perímetro y total', () => {
    const s = areaSchedule(level)
    expect(s.rows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(s.rows[0]).toMatchObject({ area: 20, perimeter: 18, type: 'Sala / comedor' })
    expect(s.rows[1]).toMatchObject({ area: 4, type: '—' })
    expect(s.total).toBe(24)
    expect(perimeter([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }])).toBe(12)
  })

  it('exporta CSV para Excel en español: BOM, punto y coma y coma decimal', () => {
    const csv = areaCsv(areaSchedule(level))
    expect(csv.startsWith('﻿Ambiente;Tipo;Área (m²);Perímetro (m);% del total\r\n')).toBe(true)
    // el nombre con ";" va entre comillas para no romper las columnas
    expect(csv).toContain('"Sala; comedor";Sala / comedor;20,00;18,00;83,33')
    expect(csv).toContain('Baño;—;4,00;8,00;16,67')
    expect(csv.trimEnd().split('\r\n').at(-1)).toBe('Área útil total;;24,00;;100,00')
  })
})

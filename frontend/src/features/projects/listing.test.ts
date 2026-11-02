import { describe, expect, it } from 'vitest'
import type { ProjectSummary } from '@/api/types'
import { sampleProject } from '@/test/fixtures'
import { listProjects, normalize, relativeTime, totalArea } from './listing'

const p = (id: string, name: string, updated_at: string, total_area: number | null): ProjectSummary => {
  const { created_at, status, error, room_count, has_source } = sampleProject()
  return { id, name, updated_at, total_area, created_at, status, error, room_count, has_source }
}

const items = [
  p('a', 'Casa en L', '2026-10-01T10:00:00Z', 120),
  p('b', 'alcoba Ñuñoa', '2026-10-03T10:00:00Z', null),
  p('c', 'Apartamento centro', '2026-10-02T10:00:00Z', 55.5),
]

describe('listProjects', () => {
  it('ordena por fecha, nombre o superficie', () => {
    expect(listProjects(items, '', 'recent').map((x) => x.id)).toEqual(['b', 'c', 'a'])
    expect(listProjects(items, '', 'name').map((x) => x.id)).toEqual(['b', 'c', 'a'])
    expect(listProjects(items, '', 'area').map((x) => x.id)).toEqual(['a', 'c', 'b'])
  })

  it('busca sin importar tildes ni mayúsculas y no muta la lista', () => {
    expect(listProjects(items, 'ÑUÑOA', 'recent').map((x) => x.id)).toEqual(['b'])
    expect(listProjects(items, 'apartamento', 'recent').map((x) => x.id)).toEqual(['c'])
    expect(listProjects(items, 'zzz', 'recent')).toEqual([])
    expect(items.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('normaliza y suma superficies', () => {
    expect(normalize('  Cocína ')).toBe('cocina')
    expect(totalArea(items)).toBeCloseTo(175.5)
  })
})

describe('relativeTime', () => {
  const now = new Date('2026-05-10T12:00:00Z').getTime()
  const ago = (s: number) => new Date(now - s * 1000).toISOString()
  it('dice cuánto hace en la unidad más natural', () => {
    expect(relativeTime(ago(20), now)).toBe('hace un momento')
    expect(relativeTime(ago(5 * 60), now)).toBe('hace 5 minutos')
    expect(relativeTime(ago(3 * 3600), now)).toBe('hace 3 horas')
    expect(relativeTime(ago(26 * 3600), now)).toBe('ayer')
    expect(relativeTime(ago(15 * 86400), now)).toBe('hace 2 semanas')
    expect(relativeTime(ago(400 * 86400), now)).toBe('el año pasado')
  })
})

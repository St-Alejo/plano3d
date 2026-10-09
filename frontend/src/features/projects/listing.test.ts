import { describe, expect, it } from 'vitest'
import type { ProjectSummary } from '@/api/types'
import { sampleProject } from '@/test/fixtures'
import { listProjects, normalize, totalArea } from './listing'

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

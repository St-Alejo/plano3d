/** Búsqueda y orden de la lista de proyectos: lógica pura, sin React. */
import type { ProjectSummary } from '@/api/types'

export type ProjectSort = 'recent' | 'name' | 'area'

export const SORT_LABEL: Record<ProjectSort, string> = {
  recent: 'Más recientes',
  name: 'Nombre (A–Z)',
  area: 'Mayor superficie',
}

import { normalize } from '@/lib/text'

export { normalize }

export function listProjects(items: ProjectSummary[], query: string, sort: ProjectSort): ProjectSummary[] {
  const q = normalize(query)
  const found = q ? items.filter((p) => normalize(p.name).includes(q)) : [...items]
  const by: Record<ProjectSort, (a: ProjectSummary, b: ProjectSummary) => number> = {
    recent: (a, b) => b.updated_at.localeCompare(a.updated_at),
    name: (a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
    // los proyectos sin superficie (aún procesando) van al final
    area: (a, b) => (b.total_area ?? -1) - (a.total_area ?? -1),
  }
  return found.sort(by[sort])
}

export function totalArea(items: ProjectSummary[]): number {
  return items.reduce((s, p) => s + (p.total_area ?? 0), 0)
}

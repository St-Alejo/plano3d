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

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['minute', 60],
  ['hour', 60],
  ['day', 24],
  ['week', 7],
  ['month', 4.345],
  ['year', 12],
]

/** "hace 5 minutos", "ayer", "hace 3 semanas": cuándo se tocó el plano por última vez. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000
  if (Math.abs(seconds) < 60) return 'hace un momento'
  let value = seconds / 60
  for (let i = 0; i < STEPS.length; i++) {
    const [unit] = STEPS[i]!
    const next = STEPS[i + 1]
    if (!next || Math.abs(value) < next[1]) return rtf.format(Math.round(value), unit)
    value /= next[1]
  }
  return rtf.format(Math.round(value), 'year')
}

import type { ProjectStatus } from '@/api/types'

export const STATUS_LABEL: Record<ProjectStatus, { text: string; tone: 'neutral' | 'accent' | 'ok' | 'danger' }> = {
  pending: { text: 'En cola', tone: 'neutral' },
  processing: { text: 'Procesando', tone: 'accent' },
  ready: { text: 'Listo', tone: 'ok' },
  failed: { text: 'Falló', tone: 'danger' },
}

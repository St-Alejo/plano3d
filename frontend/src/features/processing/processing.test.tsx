import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProgressEvent } from '@/api/types'
import { sampleModel } from '@/test/fixtures'
import { initialProgress, progressReducer } from './progressState'

const ev = (stage: string, status: ProgressEvent['status'], extra: Partial<ProgressEvent> = {}): ProgressEvent => ({
  project_id: 'p',
  stage,
  status,
  index: 0,
  total: 10,
  metrics: {},
  ...extra,
})

describe('progressReducer', () => {
  it('sigue el estado de cada etapa y conserva el último modelo parcial', () => {
    let s = progressReducer(initialProgress, ev('ingest', 'started'))
    expect(s.stages.ingest?.status).toBe('started')
    s = progressReducer(s, ev('ingest', 'completed', { elapsed_ms: 42, metrics: { width_px: 800 } }))
    expect(s.stages.ingest).toMatchObject({ status: 'completed', ms: 42, metrics: { width_px: 800 } })
    const preview = sampleModel()
    s = progressReducer(s, ev('topology', 'completed', { preview }))
    s = progressReducer(s, ev('rooms', 'started'))
    expect(s.preview).toBe(preview)
    expect(s.done).toBeNull()
  })

  it('marca fin correcto o con error', () => {
    expect(progressReducer(initialProgress, ev('done', 'completed')).done).toBe('ok')
    const failed = progressReducer(initialProgress, ev('done', 'failed', { message: 'sin muros' }))
    expect(failed).toMatchObject({ done: 'failed', error: 'sin muros' })
  })
})

// El visor 3D necesita WebGL: en jsdom se reemplaza por un marcador
vi.mock('@/features/viewer3d/Viewer3D', () => ({ Viewer3D: () => <div data-testid="viewer3d" /> }))

let emit: (e: ProgressEvent) => void = () => undefined
let finish: (ok: boolean) => void = () => undefined
vi.mock('@/api/progress', () => ({
  subscribeProgress: (_id: string, h: { onEvent: (e: ProgressEvent) => void; onDone?: (ok: boolean) => void }) => {
    emit = h.onEvent
    finish = (ok) => h.onDone?.(ok)
    return () => undefined
  },
}))

describe('ProcessingView', () => {
  it('muestra el avance en vivo, las métricas y la vista previa', async () => {
    const { ProcessingView } = await import('./ProcessingView')
    vi.useFakeTimers()
    const onFinished = vi.fn()
    render(<ProcessingView projectId="p" onFinished={onFinished} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByText(/aparecerán aquí/)).toBeInTheDocument()

    act(() => {
      emit(ev('ingest', 'completed', { elapsed_ms: 120 }))
      emit(ev('walls', 'completed', { elapsed_ms: 1500, metrics: { wall_thickness_px: 13 } }))
      emit(ev('topology', 'completed', { preview: sampleModel() }))
    })
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '23')
    expect(screen.getByText('120 ms')).toBeInTheDocument()
    expect(screen.getByText('1.5 s')).toBeInTheDocument()
    expect(screen.getByText('grosor 13 px')).toBeInTheDocument()
    expect(await vi.waitFor(() => screen.getByTestId('viewer3d'))).toBeInTheDocument()

    act(() => {
      emit(ev('done', 'completed'))
      finish(true)
    })
    expect(screen.getByText(/Abriendo el editor/)).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1000))
    expect(onFinished).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

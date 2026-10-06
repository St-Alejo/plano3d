import { screen, waitFor, within } from '@testing-library/react'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '@/api/client'
import { sampleModel, sampleProject } from '@/test/fixtures'
import { server } from '@/test/server'
import { HistoryDialog } from './HistoryDialog'

const revisions = [
  { number: 3, summary: 'Mover esquina', created_at: '2026-09-30T10:00:00Z', total_area: 61, wall_count: 5 },
  { number: 1, summary: 'Detección automática (classic-cv)', created_at: '2026-09-29T10:00:00Z', total_area: 60.3, wall_count: 5 },
]
const quality = {
  walls_detected: 5,
  walls_final: 5,
  walls_unchanged: 4,
  walls_moved: 1,
  walls_added: 0,
  walls_deleted: 0,
  openings_added: 0,
  openings_deleted: 0,
  openings_kind_changed: 0,
  rooms_relabeled: 1,
  area_detected_m2: 60.3,
  area_final_m2: 61,
  correction_rate: 0.2,
}

describe('guardado con bloqueo optimista', () => {
  it('envía If-Match con la revisión y el resumen del cambio', async () => {
    let headers: Headers | null = null
    let url = ''
    server.use(
      http.put('/api/projects/:id/model', ({ request }) => {
        headers = request.headers
        url = request.url
        return HttpResponse.json(sampleProject({ revision: 4 }))
      }),
    )
    const saved = await api.saveModel('prj_1', sampleModel(), 3, 'Mover esquina')
    expect(headers!.get('If-Match')).toBe('"3"')
    expect(new URL(url).searchParams.get('summary')).toBe('Mover esquina')
    expect(saved.revision).toBe(4)
    await api.saveModel('prj_1', sampleModel(), '*')
    expect(headers!.get('If-Match')).toBe('*')
  })

  it('un 409 llega como ApiError con el mensaje del servidor', async () => {
    server.use(http.put('/api/projects/:id/model', () => HttpResponse.json({ detail: 'El modelo cambió' }, { status: 409 })))
    const err = await api.saveModel('prj_1', sampleModel(), 1).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 409, message: 'El modelo cambió' })
  })
})

describe('HistoryDialog', () => {
  it('lista versiones, muestra la corrección y restaura una anterior', async () => {
    let restoredWith: string | null = null
    server.use(
      http.get('/api/projects/:id/revisions', () => HttpResponse.json(revisions)),
      http.get('/api/projects/:id/quality', () => HttpResponse.json(quality)),
      http.post('/api/projects/:id/revisions/:n/restore', ({ request, params }) => {
        restoredWith = `${String(params.n)}@${request.headers.get('If-Match')}`
        return HttpResponse.json(sampleProject({ revision: 4 }))
      }),
    )
    const onRestored = vi.fn()
    render(<HistoryDialog projectId="prj_1" currentRevision={3} dirty={false} onRestored={onRestored} />)
    await userEvent.click(screen.getByRole('button', { name: 'Historial de versiones' }))
    const dialog = await screen.findByRole('dialog', { name: 'Historial de versiones' })
    expect(await within(dialog).findByText(/Corrección sobre la detección automática: 20 %/)).toBeInTheDocument()
    expect(within(dialog).getByText(/v3 · Mover esquina/)).toBeInTheDocument()
    expect(within(dialog).getByText('(actual)')).toBeInTheDocument()
    // la versión actual no se puede "restaurar"; la 1 sí
    const buttons = within(dialog).getAllByRole('button', { name: 'Restaurar' })
    expect(buttons).toHaveLength(1)
    await userEvent.click(buttons[0]!)
    await waitFor(() => expect(onRestored).toHaveBeenCalled())
    expect(restoredWith).toBe('1@"3"')
  })

  it('con cambios sin guardar pide confirmación antes de restaurar', async () => {
    server.use(
      http.get('/api/projects/:id/revisions', () => HttpResponse.json(revisions)),
      http.get('/api/projects/:id/quality', () => HttpResponse.json({ detail: 'x' }, { status: 422 })),
    )
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onRestored = vi.fn()
    render(<HistoryDialog projectId="prj_1" currentRevision={3} dirty onRestored={onRestored} />)
    await userEvent.click(screen.getByRole('button', { name: 'Historial de versiones' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Restaurar' }))
    expect(confirm).toHaveBeenCalled()
    expect(onRestored).not.toHaveBeenCalled()
  })
})

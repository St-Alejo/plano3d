import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sampleModel, sampleProject } from '@/test/fixtures'
import { server } from '@/test/server'
import { useEditor } from '@/store/editorStore'
import { LayersPanel } from './LayersPanel'

describe('pisos desde el panel de capas', () => {
  beforeEach(() => useEditor.getState().load('prj_1', sampleModel(), 3))

  it('duplica el piso actual con la revisión y recarga', async () => {
    let url = ''
    let ifMatch: string | null = null
    server.use(
      http.post('/api/projects/:id/levels/:level/duplicate', ({ request }) => {
        url = request.url
        ifMatch = request.headers.get('If-Match')
        return HttpResponse.json(sampleProject({ revision: 4 }), { status: 201 })
      }),
    )
    const onReload = vi.fn()
    render(<LayersPanel onReload={onReload} />)
    await userEvent.click(screen.getByRole('button', { name: /Duplicar piso/ }))
    await waitFor(() => expect(onReload).toHaveBeenCalled())
    expect(url).toContain(`/levels/${sampleModel().levels[0]!.id}/duplicate`)
    expect(ifMatch).toBe('"3"')
  })

  it('sube otro plano como piso nuevo', async () => {
    let sent: FormDataEntryValue | null = null
    server.use(
      http.post('/api/projects/:id/levels', async ({ request }) => {
        sent = (await request.formData()).get('file')
        return HttpResponse.json(sampleProject({ revision: 4 }), { status: 201 })
      }),
    )
    const onReload = vi.fn()
    render(<LayersPanel onReload={onReload} />)
    const pdf = new File(['%PDF-1.4'], 'piso2.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText('Plano del piso nuevo'), pdf)
    await waitFor(() => expect(onReload).toHaveBeenCalled())
    expect(sent).not.toBeNull()
  })

  it('muestra el error del servidor y no recarga', async () => {
    server.use(http.post('/api/projects/:id/levels/:level/duplicate', () => HttpResponse.json({ detail: 'Otra persona guardó antes' }, { status: 409 })))
    const onReload = vi.fn()
    render(<LayersPanel onReload={onReload} />)
    await userEvent.click(screen.getByRole('button', { name: /Duplicar piso/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Otra persona guardó antes')
    expect(onReload).not.toHaveBeenCalled()
  })
})

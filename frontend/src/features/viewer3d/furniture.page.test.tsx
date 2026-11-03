import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { BuildingModel, Project } from '@/api/types'
import { sampleProject } from '@/test/fixtures'
import { server } from '@/test/server'
import { ViewerPage } from './ViewerPage'

// WebGL no funciona en jsdom: el visor muestra cuántos muebles recibió y si se ven
vi.mock('./Viewer3D', () => ({
  Viewer3D: ({ model, furniture }: { model: BuildingModel; furniture?: boolean }) => (
    <div data-testid="viewer" data-count={model.levels.reduce((n, lv) => n + (lv.furniture?.length ?? 0), 0)} data-furniture={furniture === false ? 'off' : 'on'} />
  ),
}))

function renderViewer() {
  const router = createMemoryRouter([{ path: '/p/:id/3d', element: <ViewerPage /> }], { initialEntries: ['/p/prj_1/3d'] })
  return render(<RouterProvider router={router} />)
}

function furnished(revision: number): Project {
  const p = sampleProject({ revision })
  const lv = p.model!.levels[0]!
  lv.furniture = [{ id: 'f_r1_c1', catalog_id: 'cama_doble', position: { x: 2, y: 2 }, width: 1.4, depth: 1.95, height: 1, rotation: 0 }]
  return p
}

describe('muebles en el visor', () => {
  it('sin muebles ofrece amoblar; luego el botón los quita y los pone sin recargar', async () => {
    const sent: { body: unknown; ifMatch: string | null }[] = []
    const facades: (string | null)[] = []
    server.use(
      http.get('/api/projects/:id', () => HttpResponse.json(sampleProject())),
      http.post('/api/projects/:id/furnish', async ({ request }) => {
        sent.push({ body: await request.json(), ifMatch: request.headers.get('If-Match') })
        return HttpResponse.json(furnished(2))
      }),
      http.put('/api/projects/:id/facade', ({ request }) => {
        facades.push(request.headers.get('If-Match'))
        return HttpResponse.json(furnished(3))
      }),
    )
    renderViewer()
    await userEvent.click(await screen.findByRole('button', { name: 'Amoblar según el plano' }))
    await waitFor(() => expect(screen.getByTestId('viewer')).toHaveAttribute('data-count', '1'))
    expect(sent).toEqual([{ body: { level_id: null }, ifMatch: '"1"' }])

    const toggle = screen.getByRole('button', { name: 'Muebles: sí' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(toggle)
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-furniture', 'off')
    await userEvent.click(screen.getByRole('button', { name: 'Muebles: no' }))
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-furniture', 'on')

    // la fachada se guarda sobre la revisión que dejó el amoblado
    await userEvent.click(screen.getByRole('button', { name: /^Fachada:/ }))
    await waitFor(() => expect(facades).toEqual(['"2"']))
  })

  it('si el servidor no puede amoblar, avisa', async () => {
    server.use(
      http.get('/api/projects/:id', () => HttpResponse.json(sampleProject())),
      http.post('/api/projects/:id/furnish', () => HttpResponse.json({ detail: 'Otra persona guardó antes' }, { status: 409 })),
    )
    renderViewer()
    await userEvent.click(await screen.findByRole('button', { name: 'Amoblar según el plano' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Otra persona guardó antes')
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-count', '0')
  })
})

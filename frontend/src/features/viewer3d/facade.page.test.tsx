import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { BuildingModel } from '@/api/types'
import { sampleProject } from '@/test/fixtures'
import { server } from '@/test/server'
import { ViewerPage } from './ViewerPage'

// WebGL no funciona en jsdom: el visor muestra qué fachada recibió
vi.mock('./Viewer3D', () => ({
  Viewer3D: ({ model, facade }: { model: BuildingModel; facade?: boolean }) => <div data-testid="viewer" data-facade={facade ? model.facade : 'off'} />,
}))

function renderViewer() {
  const router = createMemoryRouter([{ path: '/p/:id/3d', element: <ViewerPage /> }], { initialEntries: ['/p/prj_1/3d'] })
  return render(<RouterProvider router={router} />)
}

describe('botón de fachada del visor', () => {
  it('recorre los estilos, se ve al instante y guarda con la revisión', async () => {
    const sent: { style: string; ifMatch: string | null }[] = []
    let revision = 1
    server.use(
      http.get('/api/projects/:id', () => HttpResponse.json(sampleProject())),
      http.put('/api/projects/:id/facade', async ({ request }) => {
        const body = (await request.json()) as { style: string }
        sent.push({ style: body.style, ifMatch: request.headers.get('If-Match') })
        revision += 1
        return HttpResponse.json(sampleProject({ revision }))
      }),
    )
    renderViewer()
    const button = await screen.findByRole('button', { name: 'Fachada: Moderna blanca' })
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-facade', 'moderna_blanca')
    await userEvent.click(button)
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-facade', 'moderna_madera')
    await waitFor(() => expect(sent).toHaveLength(1))
    await userEvent.click(await screen.findByRole('button', { name: 'Fachada: Gris y madera' }))
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent).toEqual([
      { style: 'moderna_madera', ifMatch: '"1"' },
      { style: 'moderna_ladrillo', ifMatch: '"2"' },
    ])
    expect(screen.getByRole('button', { name: 'Fachada: Ladrillo y blanco' })).toBeInTheDocument()
  })

  it('si el servidor rechaza vuelve al estilo anterior y avisa', async () => {
    server.use(
      http.get('/api/projects/:id', () => HttpResponse.json(sampleProject())),
      http.put('/api/projects/:id/facade', () => HttpResponse.json({ detail: 'Otra persona guardó antes' }, { status: 409 })),
    )
    renderViewer()
    await userEvent.click(await screen.findByRole('button', { name: 'Fachada: Moderna blanca' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Otra persona guardó antes')
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-facade', 'moderna_blanca')
  })
})

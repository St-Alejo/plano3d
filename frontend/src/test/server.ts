/** Servidor MSW: la API falsa que usan los tests de componentes. */
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { sampleProject } from './fixtures'

export const handlers = [
  http.get('/api/projects', () =>
    HttpResponse.json([
      { ...sampleProject(), model: undefined },
      { ...sampleProject({ id: 'prj_2', name: 'Casa en L', status: 'processing', total_area: null, room_count: 0 }), model: undefined },
    ]),
  ),
  http.get('/api/projects/:id', ({ params }) => HttpResponse.json(sampleProject({ id: String(params.id) }))),
  http.post('/api/projects', () => HttpResponse.json({ id: 'prj_new', status: 'pending' }, { status: 202 })),
  http.put('/api/projects/:id/model', async ({ request }) =>
    HttpResponse.json(sampleProject({ model: (await request.json()) as never })),
  ),
  http.get('/api/projects/:id/progress', () => HttpResponse.json([])),
  http.post('/api/corners', () => HttpResponse.json({ corners: null })),
]

export const server = setupServer(...handlers)

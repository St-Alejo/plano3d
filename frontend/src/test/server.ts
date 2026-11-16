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
  http.get('/api/projects/:id/image', () => new HttpResponse(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } })),
  // la portada pide los destacados: por defecto no hay ninguno
  http.get('/api/featured', () => HttpResponse.json([])),
  // por defecto el servidor de prueba corre sin cuentas (como el backend en sus pruebas)
  http.get('/api/auth/config', () => HttpResponse.json({ auth_required: false, demo_enabled: true })),
]

export const server = setupServer(...handlers)

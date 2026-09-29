import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import type { ProgressEvent } from '@/api/types'
import { server } from '@/test/server'
import { ApiError, api } from './client'
import { progressUrl, subscribeProgress, type SocketLike } from './progress'

const ev = (stage: string, status: ProgressEvent['status'] = 'completed'): ProgressEvent => ({
  project_id: 'p',
  stage,
  status,
  index: 0,
  total: 10,
  metrics: {},
})

describe('api client', () => {
  it('lista y obtiene proyectos', async () => {
    const list = await api.listProjects()
    expect(list.map((p) => p.name)).toEqual(['Depto centro', 'Casa en L'])
    expect((await api.getProject('abc')).id).toBe('abc')
  })

  it('sube el archivo con nombre y esquinas como multipart', async () => {
    let received: FormData | null = null
    server.use(
      http.post('/api/projects', async ({ request }) => {
        received = await request.formData()
        return HttpResponse.json({ id: 'x', status: 'pending' }, { status: 202 })
      }),
    )
    const file = new File(['img'], 'plano.jpg', { type: 'image/jpeg' })
    await api.createProject(file, 'Casa', [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ])
    expect(received!.get('name')).toBe('Casa')
    expect(JSON.parse(String(received!.get('corners')))).toHaveLength(4)
  })

  it('convierte errores en ApiError con el detalle del backend', async () => {
    server.use(
      http.get('/api/projects/:id', () => HttpResponse.json({ detail: 'Proyecto x no encontrado' }, { status: 404 })),
      http.put('/api/projects/:id/model', () => HttpResponse.json({ detail: [{ msg: 'x' }] }, { status: 422 })),
      http.delete('/api/projects/:id', () => new HttpResponse(null, { status: 204 })),
    )
    await expect(api.getProject('x')).rejects.toMatchObject({ status: 404, message: 'Proyecto x no encontrado' })
    await expect(api.saveModel('x', {} as never)).rejects.toMatchObject({ status: 422, message: 'Datos inválidos' })
    await expect(api.deleteProject('x')).resolves.toBeUndefined()
  })

  it('error de red → ApiError(0)', async () => {
    server.use(http.get('/api/projects', () => HttpResponse.error()))
    const err = await api.listProjects().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(0)
  })

  it('arma URLs de imagen y WebSocket', () => {
    expect(api.imageUrl('a b', 'original', 'v1')).toBe('/api/projects/a%20b/image?kind=original&v=v1')
    expect(progressUrl('p', { protocol: 'https:', host: 'x.io' })).toBe('wss://x.io/api/ws/projects/p')
    expect(progressUrl('p', { protocol: 'http:', host: 'localhost:8080' })).toBe('ws://localhost:8080/api/ws/projects/p')
  })
})

class FakeSocket implements SocketLike {
  onmessage: SocketLike['onmessage'] = null
  onerror: SocketLike['onerror'] = null
  onclose: SocketLike['onclose'] = null
  closed = false
  close() {
    this.closed = true
  }
  emit(e: ProgressEvent) {
    this.onmessage?.({ data: JSON.stringify(e) })
  }
}

describe('subscribeProgress', () => {
  it('entrega eventos del WebSocket y avisa al terminar', () => {
    const sock = new FakeSocket()
    const events: string[] = []
    const onDone = vi.fn()
    const stop = subscribeProgress('p', { onEvent: (e) => events.push(e.stage), onDone }, { socket: () => sock })
    sock.emit(ev('ingest'))
    sock.emit(ev('done'))
    sock.emit(ev('tarde'))
    expect(events).toEqual(['ingest', 'done'])
    expect(onDone).toHaveBeenCalledWith(true)
    stop()
    expect(sock.closed).toBe(true)
  })

  it('si el WebSocket se cae, sigue por polling sin repetir eventos', async () => {
    const history = [ev('ingest'), ev('rectify'), ev('done', 'failed')]
    server.use(http.get('/api/projects/:id/progress', () => HttpResponse.json(history)))
    const sock = new FakeSocket()
    const events: string[] = []
    const done = new Promise<boolean>((resolve) => {
      subscribeProgress('p', { onEvent: (e) => events.push(e.stage), onDone: resolve }, { socket: () => sock, pollMs: 5 })
    })
    sock.emit(ev('ingest'))
    sock.onclose?.({})
    await expect(done).resolves.toBe(false)
    expect(events).toEqual(['ingest', 'rectify', 'done'])
  })

  it('si no se puede crear el WebSocket, usa polling desde el inicio', async () => {
    server.use(http.get('/api/projects/:id/progress', () => HttpResponse.json([ev('done')])))
    const done = new Promise<boolean>((resolve) => {
      subscribeProgress(
        'p',
        { onEvent: () => undefined, onDone: resolve },
        {
          socket: () => {
            throw new Error('sin ws')
          },
          pollMs: 5,
        },
      )
    })
    await expect(done).resolves.toBe(true)
  })
})

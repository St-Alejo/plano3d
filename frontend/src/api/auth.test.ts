import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from '@/test/server'
import { api, ApiError, refreshRetry, refreshSession } from './client'
import { tokens, type Session } from './tokens'

const session = (access: string, refresh = `r-${access}`): Session => ({
  access_token: access,
  refresh_token: refresh,
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'usr_1', email: 'ana@ejemplo.co', name: 'Ana', is_demo: false },
})

afterEach(() => tokens.clear())

describe('sesión en el cliente de la API', () => {
  it('manda el token de acceso en cada petición', async () => {
    tokens.set(session('a1'))
    let auth: string | null = null
    server.use(
      http.get('/api/projects', ({ request }) => {
        auth = request.headers.get('Authorization')
        return HttpResponse.json([])
      }),
    )
    await api.listProjects()
    expect(auth).toBe('Bearer a1')
  })

  it('con el token vencido renueva la sesión una vez y repite la petición', async () => {
    tokens.set(session('viejo', 'r1'))
    let refreshes = 0
    server.use(
      http.get('/api/projects', ({ request }) =>
        request.headers.get('Authorization') === 'Bearer nuevo'
          ? HttpResponse.json([])
          : HttpResponse.json({ detail: 'Token vencido' }, { status: 401 }),
      ),
      http.post('/api/auth/refresh', async ({ request }) => {
        refreshes += 1
        expect(await request.json()).toEqual({ refresh_token: 'r1' })
        return HttpResponse.json(session('nuevo', 'r2'))
      }),
    )
    // dos peticiones a la vez comparten el mismo refresco
    await Promise.all([api.listProjects(), api.listProjects()])
    expect(refreshes).toBe(1)
    expect(tokens.access()).toBe('nuevo')
    expect(tokens.refresh()).toBe('r2')
  })

  it('si el refresco se rechaza cierra la sesión local', async () => {
    tokens.set(session('viejo'))
    const seen: (string | null)[] = []
    const off = tokens.subscribe((u) => seen.push(u?.id ?? null))
    server.use(
      http.get('/api/projects', () => HttpResponse.json({ detail: 'x' }, { status: 401 })),
      http.post('/api/auth/refresh', () => HttpResponse.json({ detail: 'Sesión vencida' }, { status: 401 })),
    )
    await expect(api.listProjects()).rejects.toMatchObject({ status: 401 })
    expect(tokens.access()).toBeNull()
    expect(tokens.refresh()).toBeNull()
    expect(seen).toEqual([null])
    off()
  })

  it('si el servidor frena el refresco (429) reintenta y no pierde la sesión', async () => {
    tokens.set(session('a1'))
    refreshRetry.ms = 1
    let calls = 0
    server.use(
      http.post('/api/auth/refresh', () => {
        calls += 1
        return calls === 1 ? HttpResponse.json({ detail: 'Demasiados intentos' }, { status: 429 }) : HttpResponse.json(session('a2'))
      }),
    )
    expect(await refreshSession()).toBe(true)
    expect(calls).toBe(2)
    expect(tokens.access()).toBe('a2')
    refreshRetry.ms = 1000
  })

  it('si sigue frenado conserva el token para la próxima carga', async () => {
    tokens.set(session('a1'))
    refreshRetry.ms = 1
    server.use(http.post('/api/auth/refresh', () => HttpResponse.json({ detail: 'x' }, { status: 429 })))
    expect(await refreshSession()).toBe(false)
    expect(tokens.refresh()).toBe('r-a1')
    refreshRetry.ms = 1000
  })

  it('una contraseña equivocada no intenta renovar', async () => {
    tokens.set(session('a1'))
    let refreshed = false
    server.use(
      http.post('/api/auth/login', () => HttpResponse.json({ detail: 'Correo o contraseña incorrectos' }, { status: 401 })),
      http.post('/api/auth/refresh', () => {
        refreshed = true
        return HttpResponse.json(session('b'))
      }),
    )
    const err = await api.auth.login('ana@ejemplo.co', 'mala').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).toBe('Correo o contraseña incorrectos')
    expect(refreshed).toBe(false)
  })

  it('descarga la imagen del plano con la sesión', async () => {
    tokens.set(session('a1'))
    server.use(
      http.get('/api/projects/:id/image', ({ request }) =>
        request.headers.get('Authorization') === 'Bearer a1'
          ? new HttpResponse(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } })
          : new HttpResponse(null, { status: 401 }),
      ),
    )
    const blob = await api.imageBlob('p1')
    expect(blob.size).toBe(3)
  })
})

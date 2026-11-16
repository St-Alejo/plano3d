import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { tokens, type Session } from '@/api/tokens'
import { resetAuthForTests } from '@/store/authStore'
import { server } from '@/test/server'
import { AuthPage } from './AuthPage'
import { RequireAuth } from './RequireAuth'
import { safeNext } from './session'

const demoSession: Session = {
  access_token: 'acc-demo',
  refresh_token: 'ref-demo',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'usr_demo', email: 'demo@plano3d.app', name: 'Cuenta demo', is_demo: true },
}

function app(initial: string) {
  const router = createMemoryRouter(
    [
      { path: '/entrar', element: <AuthPage mode="login" /> },
      { path: '/registro', element: <AuthPage mode="register" /> },
      { element: <RequireAuth />, children: [{ path: '/proyectos', element: <p>mis proyectos</p> }, { path: '/p/:id', element: <p>el editor</p> }] },
    ],
    { initialEntries: [initial] },
  )
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  resetAuthForTests()
  server.use(http.get('/api/auth/config', () => HttpResponse.json({ auth_required: true, demo_enabled: true })))
})
afterEach(() => tokens.clear())

describe('entrada y rutas protegidas', () => {
  it('sin sesión, una ruta de la app lleva a la entrada y recuerda a dónde volver', async () => {
    const router = app('/p/prj_1')
    expect(await screen.findByRole('heading', { name: 'Entra a tus planos' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?next=%2Fp%2Fprj_1')
  })

  it('el botón de la demo entra y vuelve a la ruta pedida', async () => {
    server.use(http.post('/api/auth/demo', () => HttpResponse.json(demoSession)))
    app('/entrar?next=%2Fp%2Fprj_demo_casa3')
    await userEvent.click(await screen.findByRole('button', { name: /Entrar con la cuenta demo/ }))
    expect(await screen.findByText('el editor')).toBeInTheDocument()
    expect(tokens.access()).toBe('acc-demo')
  })

  it('muestra el error del servidor con la contraseña equivocada', async () => {
    server.use(http.post('/api/auth/login', () => HttpResponse.json({ detail: 'Correo o contraseña incorrectos' }, { status: 401 })))
    app('/entrar')
    await userEvent.type(await screen.findByLabelText('Correo'), 'ana@ejemplo.co')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mala-clave')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos')
  })

  it('con un token de refresco guardado entra sin pedir la contraseña', async () => {
    tokens.set(demoSession)
    // simula una visita nueva: el de acceso no está en memoria, el de refresco sí
    const refresh = tokens.refresh()
    tokens.clear()
    window.localStorage.setItem('plano3d.refresh', refresh ?? '')
    server.use(http.post('/api/auth/refresh', () => HttpResponse.json({ ...demoSession, access_token: 'acc-2' })))
    app('/proyectos')
    expect(await screen.findByText('mis proyectos')).toBeInTheDocument()
  })

  it('un servidor sin cuentas deja pasar directo', async () => {
    server.use(http.get('/api/auth/config', () => HttpResponse.json({ auth_required: false, demo_enabled: false })))
    app('/proyectos')
    await waitFor(() => expect(screen.getByText('mis proyectos')).toBeInTheDocument())
  })

  it('solo acepta destinos internos', () => {
    expect(safeNext('/p/1')).toBe('/p/1')
    expect(safeNext('//malo.com')).toBe('/proyectos')
    expect(safeNext('https://malo.com')).toBe('/proyectos')
    expect(safeNext('/\\malo.com')).toBe('/proyectos')
    expect(safeNext(null)).toBe('/proyectos')
  })
})

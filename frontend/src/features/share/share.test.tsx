import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { Share } from '@/api/client'
import { server } from '@/test/server'
import { interioresUrl } from './interiores'
import { ShareWithInteriores } from './ShareWithInteriores'

const share = (code: string, claimed: string | null = null): Share => ({
  code,
  app: 'interiores',
  created_at: '2026-11-16T15:00:00Z',
  claimed_at: claimed,
})

describe('Continuar en Interiores 3D', () => {
  it('el enlace abre la pantalla de conectar con el código puesto', () => {
    expect(interioresUrl('K7QM-3XTP', 'https://interiores.test/')).toBe('https://interiores.test//conectar?codigo=K7QM-3XTP')
    expect(interioresUrl('AB CD', 'http://x')).toBe('http://x/conectar?codigo=AB%20CD')
  })

  it('sin códigos activos crea el primero y lo muestra con el enlace a Interiores', async () => {
    let created = 0
    server.use(
      http.get('/api/projects/:id/shares', () => HttpResponse.json([])),
      http.post('/api/projects/:id/shares', () => {
        created += 1
        return HttpResponse.json(share('K7QM-3XTP'), { status: 201 })
      }),
    )
    render(<ShareWithInteriores open onOpenChange={() => {}} projectId="prj_1" />)
    expect(await screen.findByLabelText('Código para compartir')).toHaveTextContent('K7QM-3XTP')
    expect(created).toBe(1)
    expect(screen.getByRole('link', { name: /Abrir Interiores 3D/ })).toHaveAttribute('href', expect.stringContaining('/conectar?codigo=K7QM-3XTP'))
    expect(screen.getByText('Todavía nadie lo ha usado')).toBeInTheDocument()
  })

  it('reutiliza el código activo y revocarlo lo quita de la lista', async () => {
    let revoked = ''
    server.use(
      http.get('/api/projects/:id/shares', () => HttpResponse.json([share('AAAA-BBBB', '2026-11-16T16:00:00Z'), share('CCCC-DDDD')])),
      http.post('/api/projects/:id/shares', () => HttpResponse.json(share('ZZZZ-ZZZZ'), { status: 201 })),
      http.delete('/api/projects/:id/shares/:code', ({ params }) => {
        revoked = String(params.code)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    render(<ShareWithInteriores open onOpenChange={() => {}} projectId="prj_1" />)
    expect(await screen.findByLabelText('Código para compartir')).toHaveTextContent('AAAA-BBBB')
    expect(screen.getByText(/Conectado por última vez/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Revocar CCCC-DDDD' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Revocar CCCC-DDDD' })).not.toBeInTheDocument())
    expect(revoked).toBe('CCCC-DDDD')
  })

  it('si la API falla avisa y deja reintentar', async () => {
    server.use(http.get('/api/projects/:id/shares', () => HttpResponse.json({ detail: 'x' }, { status: 500 })))
    render(<ShareWithInteriores open onOpenChange={() => {}} projectId="prj_1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo pedir el código')
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})

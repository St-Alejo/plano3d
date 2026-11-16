import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { server } from '@/test/server'
import { DesktopPage } from './DesktopPage'
import { OpenInDesktop } from './OpenInDesktop'
import { DOWNLOAD_URL, RELEASES_API, deepLink, formatSize, parseRelease } from './release'

const SHA = 'a'.repeat(64)
const release = (extra: object = {}) => ({
  tag_name: 'v1.2.0',
  published_at: '2026-11-16T15:00:00Z',
  body: 'Primera versión',
  assets: [
    { name: 'otra-cosa.zip', size: 10 },
    { name: 'Plano3D-Setup.exe', size: 90_596_966, digest: `sha256:${SHA}` },
  ],
  ...extra,
})

describe('release de la app de escritorio', () => {
  it('lee versión, tamaño y SHA-256 del instalador', () => {
    expect(parseRelease(release())).toEqual({ version: '1.2.0', size: 90_596_966, published: '2026-11-16T15:00:00Z', sha256: SHA })
  })

  it('sin resumen de GitHub toma el SHA-256 de las notas', () => {
    const b = 'B'.repeat(64)
    const r = release({ body: `SHA-256: ${b}`, assets: [{ name: 'Plano3D-Setup.exe', size: 5 }] })
    expect(parseRelease(r)?.sha256).toBe(b.toLowerCase())
  })

  it('un release sin el instalador no cuenta', () => {
    expect(parseRelease(release({ assets: [] }))).toBeNull()
    expect(parseRelease(null)).toBeNull()
  })

  it('formatea el tamaño y arma el enlace plano3d://', () => {
    expect(formatSize(90_596_966)).toBe('86 MB')
    expect(formatSize(0)).toBe('')
    expect(deepLink('prj demo', 'AB12CD')).toBe('plano3d://open?project=prj%20demo&code=AB12CD')
  })
})

describe('página /escritorio', () => {
  it('ofrece la descarga estable con la versión, el tamaño y el SHA-256', async () => {
    server.use(http.get(RELEASES_API, () => HttpResponse.json(release())))
    render(
      <MemoryRouter>
        <DesktopPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Plano 3D para Windows' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Descargar para Windows/ })).toHaveAttribute('href', DOWNLOAD_URL)
    expect(await screen.findByText(/Versión 1\.2\.0 · 86 MB/)).toBeInTheDocument()
    expect(screen.getByText(SHA)).toBeInTheDocument()
    expect(screen.getByText(/Ejecutar de todas formas/)).toBeInTheDocument()
  })

  it('si aún no hay release lo dice sin romperse', async () => {
    server.use(http.get(RELEASES_API, () => new HttpResponse(null, { status: 404 })))
    render(
      <MemoryRouter>
        <DesktopPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/aún no está publicado/)).toBeInTheDocument()
  })
})

describe('abrir en escritorio', () => {
  it('pide un código y abre la app con plano3d://', async () => {
    let asked = 0
    server.use(
      http.post('/api/auth/link-codes', () => {
        asked++
        return HttpResponse.json({ code: `ABC12${asked}`, expires_in: 120 })
      }),
    )
    render(
      <MemoryRouter>
        <OpenInDesktop open onOpenChange={() => {}} projectId="prj_1" />
      </MemoryRouter>,
    )
    expect(await screen.findByLabelText('Código para la app')).toHaveTextContent('ABC121')
    expect(screen.getByRole('link', { name: /Abrir Plano 3D/ })).toHaveAttribute('href', 'plano3d://open?project=prj_1&code=ABC121')
    expect(screen.getByText(/vence en 2:00/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Descargar para Windows/ })).toHaveAttribute('href', '/escritorio')

    await userEvent.click(screen.getByRole('button', { name: /Otro código/ }))
    expect(await screen.findByLabelText('Código para la app')).toHaveTextContent('ABC122')
  })
})

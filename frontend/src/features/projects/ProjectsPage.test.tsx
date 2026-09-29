import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import { renderWithRouter } from '@/test/render'
import { ProjectsPage } from './ProjectsPage'

describe('ProjectsPage', () => {
  it('lista los proyectos con estado, superficie y ambientes', async () => {
    renderWithRouter(<ProjectsPage />)
    const list = await screen.findByRole('list', { name: 'Proyectos' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getByText('Depto centro')).toBeInTheDocument()
    expect(within(items[0]!).getByText('Listo')).toBeInTheDocument()
    expect(within(items[0]!).getByText('60.3 m²')).toBeInTheDocument()
    expect(within(items[1]!).getByText('Procesando')).toBeInTheDocument()
    expect(within(items[1]!).getByText('— m²')).toBeInTheDocument()
  })

  it('muestra un estado vacío que invita a tomar la primera foto', async () => {
    server.use(http.get('/api/projects', () => HttpResponse.json([])))
    renderWithRouter(<ProjectsPage />)
    expect(await screen.findByText('Todavía no hay planos')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /tomar foto de un plano/i })).toHaveAttribute('href', '/nuevo')
  })

  it('muestra el error y permite reintentar', async () => {
    let calls = 0
    server.use(
      http.get('/api/projects', () => {
        calls += 1
        return calls === 1 ? HttpResponse.json({ detail: 'caído' }, { status: 500 }) : HttpResponse.json([])
      }),
    )
    renderWithRouter(<ProjectsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('caído')
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Todavía no hay planos')).toBeInTheDocument()
  })

  it('elimina un proyecto tras confirmar', async () => {
    server.use(http.delete('/api/projects/:id', () => new HttpResponse(null, { status: 204 })))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderWithRouter(<ProjectsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar Depto centro' }))
    expect(await screen.findAllByRole('listitem')).toHaveLength(1)
  })
})

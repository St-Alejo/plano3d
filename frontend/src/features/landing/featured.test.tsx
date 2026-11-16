import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { renderWithRouter } from '@/test/render'
import { server } from '@/test/server'
import { FeaturedProjects } from './Featured'

const casa = {
  id: 'prj_destacado_casa4',
  name: 'Casa Mirador — 4 pisos',
  summary: 'Casa moderna de cuatro pisos con azotea.',
  levels: 4,
  rooms: 37,
  total_area: 864,
  cover: '/destacados/casa4/portada.webp',
  video: null,
}

describe('Proyectos destacados en la portada', () => {
  it('muestra la casa con sus cifras y lleva a su visor público', async () => {
    server.use(http.get('/api/featured', () => HttpResponse.json([casa])))
    renderWithRouter(<FeaturedProjects />)
    expect(await screen.findByRole('heading', { name: casa.name })).toBeInTheDocument()
    expect(screen.getByText('37')).toBeInTheDocument()
    expect(screen.getByText('864')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Fachada de Casa Mirador/ })).toHaveAttribute('src', casa.cover)
    expect(screen.getByRole('link', { name: /Recorrerla en 3D/ })).toHaveAttribute('href', '/destacados/prj_destacado_casa4')
  })

  it('con video, el recorrido reemplaza a la portada', async () => {
    server.use(http.get('/api/featured', () => HttpResponse.json([{ ...casa, video: '/destacados/casa4/recorrido.mp4' }])))
    const { container } = renderWithRouter(<FeaturedProjects />)
    await screen.findByRole('heading', { name: casa.name })
    expect(container.querySelector('video')).toHaveAttribute('poster', casa.cover)
  })

  it('sin destacados (o sin API) la sección no aparece', async () => {
    server.use(http.get('/api/featured', () => HttpResponse.error()))
    const { container } = renderWithRouter(<FeaturedProjects />)
    await new Promise((r) => setTimeout(r, 50))
    expect(container.querySelector('section')).toBeNull()
  })
})

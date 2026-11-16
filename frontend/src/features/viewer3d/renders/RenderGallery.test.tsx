import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenderInfo } from '@/api/types'
import { collabActions } from '@/collab/collabStore'
import { server } from '@/test/server'
import { RenderGallery } from './RenderGallery'

const base = (id: string, label: string): RenderInfo => ({
  id: `prj_1-${id}`,
  label,
  camera: label,
  quality: 'final',
  hour: 'atardecer',
  media_type: 'image/jpeg',
  size_bytes: 1234,
  width: 1920,
  height: 1080,
  created_at: '2026-11-16T15:00:00+00:00',
})

beforeEach(() => {
  collabActions.reset()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:render'), revokeObjectURL: vi.fn() }))
  server.use(http.get('/api/projects/:id/renders/:rid', () => new HttpResponse(new Blob(['jpg']), { headers: { 'Content-Type': 'image/jpeg' } })))
})

afterEach(() => vi.unstubAllGlobals())

describe('galería de renders de Blender', () => {
  it('sin renders explica cómo hacerlos desde la app de escritorio', async () => {
    server.use(http.get('/api/projects/:id/renders', () => HttpResponse.json([])))
    render(<RenderGallery open onOpenChange={() => {}} projectId="prj_1" fileBase="casa" />)
    expect(await screen.findByText('Todavía no hay renders')).toBeInTheDocument()
  })

  it('muestra el más nuevo y salta solo al que llega en vivo desde el escritorio', async () => {
    server.use(http.get('/api/projects/:id/renders', () => HttpResponse.json([base('a', 'Fachada principal'), base('b', 'Calle')])))
    render(<RenderGallery open onOpenChange={() => {}} projectId="prj_1" fileBase="casa" />)
    expect(await screen.findByText(/Calle · 1 \/ 2/)).toBeInTheDocument()
    expect(screen.getByText(/Final · Atardecer · 1920×1080/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Fachada principal' }))
    expect(screen.getByText(/Fachada principal · 2 \/ 2/)).toBeInTheDocument()

    // un render de otro proyecto no entra; el de este se muestra con la marca de nuevo
    act(() => collabActions.renderAdded({ ...base('z', 'Ajeno'), id: 'prj_9-z' }))
    act(() => collabActions.renderAdded(base('c', 'Sala · Piso 1')))
    expect(await screen.findByText(/Sala · Piso 1 · 1 \/ 3/)).toBeInTheDocument()
    expect(screen.getByText('Nuevo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ajeno' })).not.toBeInTheDocument()
  })
})

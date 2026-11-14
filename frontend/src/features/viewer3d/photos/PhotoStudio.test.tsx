import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import type { BuildingModel } from '@/api/types'
import opc3 from '@/test/opc3.json'
import { server } from '@/test/server'
import type { CaptureFn } from '../Viewer3D'
import { PhotoStudio } from './PhotoStudio'

const model = opc3 as unknown as BuildingModel
const IMG = 'data:image/jpeg;base64,/9j/'

function setup(capture: CaptureFn | null = vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' }))) {
  const prepare = vi.fn(async () => {})
  render(
    <PhotoStudio open onOpenChange={() => {}} projectId="prj_1" fileBase="casa" facade="Moderna blanca" model={model} captureRef={{ current: capture }} prepare={prepare} />,
  )
  return { prepare, capture }
}

describe('fotos realistas con IA', () => {
  it('captura cuatro tomas, pide cinco fotos y las muestra en la galería', async () => {
    let sent: FormData | null = null
    server.use(
      http.get('/api/photos/status', () => HttpResponse.json({ available: true, remaining_usd: 1.8, cost_per_photo: 0.02 })),
      http.post('/api/projects/:id/photos', async ({ request }) => {
        sent = await request.formData()
        const views = String(sent.get('views')).split(',')
        return HttpResponse.json({ photos: views.map((v) => ({ view: v, label: `Vista ${v}`, image: IMG })), failed: 0, remaining_usd: 1.72 })
      }),
    )
    const { prepare, capture } = setup()
    expect(await screen.findByText(/Costo aproximado US\$0,10 · quedan US\$1,80/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Generar 5 fotos' }))

    const gallery = await screen.findByRole('list', { name: 'Fotos generadas' })
    expect(prepare).toHaveBeenCalledOnce()
    // la calle se captura una vez para el día y la noche
    expect(capture).toHaveBeenCalledTimes(4)
    expect(sent!.get('views')).toBe('calle,esquina,costado,noche,interior')
    expect(sent!.getAll('images')).toHaveLength(5)
    expect(sent!.get('facade')).toBe('Moderna blanca')
    expect(gallery.querySelectorAll('li')).toHaveLength(5)
    expect(screen.getByText('Quedan US$1,72 del tope para fotos con IA')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descargar las 5' })).toBeEnabled()
  })

  it('si el servidor no tiene clave, el botón queda apagado y lo explica', async () => {
    server.use(http.get('/api/photos/status', () => HttpResponse.json({ available: false, remaining_usd: 0, cost_per_photo: 0 })))
    setup()
    expect(await screen.findByText('Las fotos con IA no están configuradas en este servidor.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generar 5 fotos' })).toBeDisabled()
  })

  it('un error de OpenAI se muestra y se puede reintentar', async () => {
    server.use(
      http.get('/api/photos/status', () => HttpResponse.json({ available: true, remaining_usd: 1, cost_per_photo: 0.02 })),
      http.post('/api/projects/:id/photos', () => HttpResponse.json({ detail: 'La cuenta de OpenAI se quedó sin créditos' }, { status: 503 })),
    )
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Generar 5 fotos' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('La cuenta de OpenAI se quedó sin créditos')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeEnabled())
  })
})

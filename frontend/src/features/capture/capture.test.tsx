import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { Corners } from '@/api/client'
import { server } from '@/test/server'
import { renderWithRouter } from '@/test/render'
import { CornerEditor } from './CornerEditor'
import { DEFAULT_CORNERS } from './corners'
import { NewPlanPage } from './NewPlanPage'
import { validateFile } from './validateFile'

const jpg = (name = 'depto_3b.jpg', size = 10) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' })

describe('validateFile', () => {
  it('acepta imágenes y PDF, rechaza el resto y los archivos enormes', () => {
    expect(validateFile(jpg())).toBeNull()
    expect(validateFile(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBeNull()
    expect(validateFile(new File(['x'], 'a.gif', { type: 'image/gif' }))).toMatch(/no soportado/)
    // DXF de CAD: el navegador lo manda sin tipo o como octet-stream; vale la extensión
    expect(validateFile(new File(['SECTION'], 'casa.dxf', { type: '' }))).toBeNull()
    expect(validateFile(new File(['x'], 'casa.DXF', { type: 'application/octet-stream' }))).toBeNull()
    expect(validateFile(new File(['x'], 'casa.dwg', { type: 'application/octet-stream' }))).toMatch(/no soportado/)
    const huge = jpg('big.jpg')
    Object.defineProperty(huge, 'size', { value: 26 * 1024 * 1024 })
    expect(validateFile(huge)).toMatch(/25 MB/)
  })
})

describe('NewPlanPage', () => {
  it('sube la foto con el nombre sugerido y navega al proyecto', async () => {
    let form: FormData | null = null
    server.use(
      http.post('/api/projects', async ({ request }) => {
        form = await request.formData()
        return HttpResponse.json({ id: 'prj_new', status: 'pending' }, { status: 202 })
      }),
    )
    const { router } = renderWithRouter(<NewPlanPage />)
    await userEvent.upload(screen.getByTestId('file-input'), jpg())
    expect(screen.getByLabelText('Nombre del proyecto')).toHaveValue('depto 3b')
    await userEvent.click(screen.getByRole('button', { name: 'Convertir a 3D' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/p/prj_new'))
    expect(form!.get('name')).toBe('depto 3b')
    expect(form!.get('corners')).toBeNull() // detección automática
  })

  it('envía las esquinas cuando se ajustan manualmente', async () => {
    let corners: string | null = null
    server.use(
      http.post('/api/projects', async ({ request }) => {
        corners = String((await request.formData()).get('corners'))
        return HttpResponse.json({ id: 'x', status: 'pending' }, { status: 202 })
      }),
    )
    renderWithRouter(<NewPlanPage />)
    await userEvent.upload(screen.getByTestId('file-input'), jpg())
    await userEvent.click(screen.getByRole('button', { name: 'Ajustar esquinas' }))
    expect(screen.getAllByRole('slider')).toHaveLength(4)
    await userEvent.click(screen.getByRole('button', { name: 'Convertir a 3D' }))
    await waitFor(() => expect(JSON.parse(corners!)).toEqual(DEFAULT_CORNERS))
  })

  it('rechaza formatos no soportados sin subir nada', async () => {
    renderWithRouter(<NewPlanPage />)
    const input = screen.getByTestId('file-input')
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent(/no soportado/)
    expect(screen.queryByRole('button', { name: 'Convertir a 3D' })).not.toBeInTheDocument()
  })

  it('muestra el error del servidor y permite reintentar', async () => {
    server.use(http.post('/api/projects', () => HttpResponse.json({ detail: 'Tipo no soportado' }, { status: 415 })))
    renderWithRouter(<NewPlanPage />)
    await userEvent.upload(screen.getByTestId('file-input'), jpg())
    await userEvent.click(screen.getByRole('button', { name: 'Convertir a 3D' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tipo no soportado')
    expect(screen.getByRole('button', { name: 'Convertir a 3D' })).toBeEnabled()
  })
})

function Harness({ onValue }: { onValue: (c: Corners) => void }) {
  const [c, setC] = useState<Corners>(DEFAULT_CORNERS)
  return (
    <CornerEditor
      src="blob:x"
      corners={c}
      onChange={(n) => {
        setC(n)
        onValue(n)
      }}
    />
  )
}

describe('CornerEditor', () => {
  it('mueve una esquina con el teclado y la mantiene dentro de 0..1', async () => {
    let last: Corners = DEFAULT_CORNERS
    render(<Harness onValue={(c) => (last = c)} />)
    const tl = screen.getByRole('slider', { name: 'Esquina superior izquierda' })
    tl.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(last[0]![0]).toBeCloseTo(0.064)
    await userEvent.keyboard('{Shift>}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{/Shift}')
    expect(last[0]![1]).toBe(0)
    expect(last[1]).toEqual(DEFAULT_CORNERS[1])
  })
})

describe('esquinas sugeridas', () => {
  it('al ajustar a mano, arranca desde las esquinas que detectó el backend', async () => {
    const detected = [
      [0.1, 0.12],
      [0.88, 0.1],
      [0.9, 0.86],
      [0.12, 0.9],
    ]
    let sent: string | null = null
    server.use(
      http.post('/api/corners', () => HttpResponse.json({ corners: detected })),
      http.post('/api/projects', async ({ request }) => {
        sent = String((await request.formData()).get('corners'))
        return HttpResponse.json({ id: 'x', status: 'pending' }, { status: 202 })
      }),
    )
    renderWithRouter(<NewPlanPage />)
    await userEvent.upload(screen.getByTestId('file-input'), jpg())
    await userEvent.click(screen.getByRole('button', { name: 'Ajustar esquinas' }))
    await waitFor(() =>
      expect(screen.getByRole('slider', { name: 'Esquina superior izquierda' })).toHaveAttribute('aria-valuenow', '10'),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Convertir a 3D' }))
    await waitFor(() => expect(JSON.parse(sent!)).toEqual(detected))
  })
})

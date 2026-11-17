import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import type { BuildingModel } from '@/api/types'
import { selectLevel, useEditor } from '@/store/editorStore'
import { server } from '@/test/server'
import { ChatPanel } from './ChatPanel'

const blank = (): BuildingModel => ({
  project_id: 'prj_b',
  facade: 'moderna_blanca',
  scale: { meters_per_pixel: 0.01, source: 'vector', confidence: 1 },
  levels: [{ id: 'lvl_0', name: 'Planta 1', elevation: 0, walls: [], rooms: [] }],
})
const level = () => selectLevel(useEditor.getState())!

beforeEach(() => {
  useEditor.getState().reset()
  useEditor.getState().load('prj_b', blank())
})

async function say(text: string) {
  await userEvent.type(screen.getByRole('textbox', { name: 'Mensaje para el plano' }), `${text}{Enter}`)
}

describe('chat del estudio', () => {
  it('lo que entiende el intérprete local se aplica sin llamar al servidor y se deshace', async () => {
    let calls = 0
    server.use(http.post('/api/projects/:id/assistant', () => (calls++, HttpResponse.json({ ops: [], reply: '' }))))
    render(<ChatPanel projectId="prj_b" defaultOpen />)
    await say('sala de 4x5 con puerta al sur')
    expect(await screen.findByText('Dibujé Sala de 4 × 5 m')).toBeInTheDocument()
    expect(level().rooms.map((r) => r.label)).toEqual(['Sala'])
    expect(calls).toBe(0)
    expect(useEditor.getState().selection).toMatchObject({ kind: 'room' })
    await userEvent.click(screen.getByRole('button', { name: 'Deshacer' }))
    expect(level().walls).toHaveLength(0)
  })

  it('lo que no entiende va a la IA y aplica sus operaciones', async () => {
    let sent: { message: string; context: string } | null = null
    server.use(
      http.post('/api/projects/:id/assistant', async ({ request }) => {
        sent = (await request.json()) as { message: string; context: string }
        return HttpResponse.json({ ops: [{ op: 'add_room', name: 'Estudio', width: 3, depth: 3 }], reply: 'Te dibujé un estudio.' })
      }),
    )
    render(<ChatPanel projectId="prj_b" defaultOpen />)
    await say('quiero un lugar tranquilo para trabajar')
    expect(await screen.findByText('Te dibujé un estudio.')).toBeInTheDocument()
    expect(sent).toEqual({ message: 'quiero un lugar tranquilo para trabajar', context: '(vacío)', scope: 'plan' })
    expect(level().rooms.map((r) => r.label)).toEqual(['Estudio'])
  })

  it('sin IA disponible explica y muestra ejemplos', async () => {
    server.use(http.post('/api/projects/:id/assistant', () => HttpResponse.json({ detail: 'no' }, { status: 503 })))
    render(<ChatPanel projectId="prj_b" defaultOpen />)
    await say('hazlo bonito')
    expect(await screen.findByText(/No entendí «hazlo bonito»/)).toBeInTheDocument()
    expect(screen.getAllByText('sala de 4x5').length).toBeGreaterThan(0)
  })

  it('un error del plano se explica sin aplicar nada', async () => {
    render(<ChatPanel projectId="prj_b" defaultOpen />)
    await say('puerta al sur de la cocina')
    expect(await screen.findByText(/No encuentro el ambiente «cocina»/)).toBeInTheDocument()
    expect(level().walls).toHaveLength(0)
  })

  it('si la lectura local no se puede aplicar, le pregunta a la IA', async () => {
    let calls = 0
    server.use(
      http.post('/api/projects/:id/assistant', () => {
        calls++
        return HttpResponse.json({ ops: [{ op: 'add_room', name: 'Cocina', width: 3, depth: 3 }], reply: 'Dibujé la cocina primero.' })
      }),
    )
    render(<ChatPanel projectId="prj_b" defaultOpen />)
    await say('puerta al sur de la cocina')
    expect(await screen.findByText('Dibujé la cocina primero.')).toBeInTheDocument()
    expect(calls).toBe(1)
    expect(screen.queryByText(/No encuentro el ambiente/)).not.toBeInTheDocument()
  })

  it('«otro piso igual» copia el piso en el servidor y recarga el proyecto', async () => {
    const asked: string[] = []
    let reloads = 0
    server.use(
      http.post('/api/projects/:id/levels/:level/duplicate', ({ params }) => {
        asked.push(String(params.level))
        const model = { ...blank(), levels: [...blank().levels, { ...blank().levels[0], id: 'lvl_1', name: 'Planta 2', elevation: 2.7 }] }
        return HttpResponse.json({ id: 'prj_b', revision: 2, model })
      }),
    )
    render(<ChatPanel projectId="prj_b" defaultOpen onReload={() => reloads++} />)
    await say('coloca otro piso igual al que ya está')
    expect(await screen.findByText('Agregué Planta 2, igual a Planta 1')).toBeInTheDocument()
    expect(asked).toEqual(['lvl_0'])
    expect(reloads).toBe(1)
  })

  it('con cambios sin guardar no copia el piso y lo explica', async () => {
    let calls = 0
    server.use(http.post('/api/projects/:id/levels/:level/duplicate', () => (calls++, HttpResponse.json({}))))
    render(<ChatPanel projectId="prj_b" defaultOpen />)
    await say('sala de 4x5')
    await say('duplica el piso')
    expect(await screen.findByText(/Guarda los cambios/)).toBeInTheDocument()
    expect(calls).toBe(0)
  })

  it('la IA también puede pedir el piso nuevo (duplicate_level)', async () => {
    let dup = 0
    server.use(
      http.post('/api/projects/:id/assistant', () => HttpResponse.json({ ops: [{ op: 'duplicate_level' }], reply: 'Subí una copia del piso.' })),
      http.post('/api/projects/:id/levels/:level/duplicate', () => (dup++, HttpResponse.json({ id: 'prj_b', revision: 2, model: blank() }))),
    )
    render(<ChatPanel projectId="prj_b" defaultOpen />)
    await say('quiero la casa un nivel más alta con la misma distribución')
    expect(await screen.findByText('Subí una copia del piso.')).toBeInTheDocument()
    expect(dup).toBe(1)
  })

  it('cerrado muestra el botón para abrirlo', async () => {
    render(<ChatPanel projectId="prj_b" />)
    await userEvent.click(screen.getByRole('button', { name: /Dibujar escribiendo/ }))
    expect(screen.getByRole('region', { name: 'Chat del plano' })).toBeInTheDocument()
  })
})

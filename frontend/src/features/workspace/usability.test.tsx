/** Regresiones de los hallazgos de la auditoría de usabilidad (docs/usabilidad.md). */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { createMemoryRouter, Link, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '@/api/client'
import { TranslateWall } from '@/domain/commands'
import { findLevel, findWall } from '@/domain/model'
import { PropertiesPanel } from '@/features/editor2d/PropertiesPanel'
import { sampleModel } from '@/test/fixtures'
import { server } from '@/test/server'
import { useEditor } from '@/store/editorStore'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'
import { useEditorShortcuts } from './useShortcuts'

const L = 'lvl_0'
const level = () => findLevel(useEditor.getState().model!, L)

beforeEach(() => {
  useEditor.getState().reset()
  useEditor.getState().load('prj_1', sampleModel())
})

describe('H3 · el editor se puede usar sin mouse', () => {
  it('la lista de elementos permite seleccionar ambientes y muros con el teclado', async () => {
    render(<PropertiesPanel />)
    const list = screen.getByRole('region', { name: 'Ambientes' })
    const room = within(list).getByRole('button', { name: /Espacio 2/ })
    room.focus()
    await userEvent.keyboard('{Enter}')
    expect(useEditor.getState().selection).toEqual({ kind: 'room', id: 'r_b' })
  })

  it('marca los ambientes de baja confianza también con texto (no solo color)', () => {
    render(<PropertiesPanel />)
    const list = screen.getByRole('region', { name: 'Ambientes' })
    const item = within(list).getByRole('button', { name: /Espacio 2/ })
    expect(item).toContainElement(within(item).getByLabelText('baja confianza'))
  })

  it('desde un muro se llega a sus aberturas', async () => {
    act(() => useEditor.getState().select({ kind: 'wall', id: 'w_mid' }))
    render(<PropertiesPanel />)
    await userEvent.click(screen.getByRole('button', { name: /Puerta/ }))
    expect(useEditor.getState().selection).toMatchObject({ kind: 'opening', id: 'o_door' })
  })

  function Host() {
    useEditorShortcuts()
    return null
  }

  it('las flechas mueven el muro seleccionado (5 cm, 25 cm con Shift) y se deshace', async () => {
    render(<Host />)
    act(() => useEditor.getState().select({ kind: 'wall', id: 'w_mid' }))
    await userEvent.keyboard('{ArrowRight}')
    expect(findWall(level(), 'w_mid').start.x).toBeCloseTo(6.05)
    await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}')
    expect(findWall(level(), 'w_mid').start.y).toBeCloseTo(-0.25)
    await userEvent.keyboard('{Control>}z{/Control}{Control>}z{/Control}')
    expect(findWall(level(), 'w_mid').start).toEqual({ x: 6, y: 0 })
  })

  it('TranslateWall es reversible y conserva las aberturas', () => {
    const cmd = new TranslateWall(L, 'w_mid', 1, 2)
    const m = cmd.execute(sampleModel())
    const w = findWall(findLevel(m, L), 'w_mid')
    expect(w.start).toEqual({ x: 7, y: 2 })
    expect(w.openings).toHaveLength(1)
    expect(cmd.undo(m)).toEqual(sampleModel())
  })
})

describe('H1 · no se pierden cambios al navegar dentro de la app', () => {
  function Page() {
    const [dirty, setDirty] = useState(true)
    return (
      <>
        <UnsavedChangesGuard
          dirty={dirty}
          onSave={async () => {
            setDirty(false)
            return true
          }}
        />
        <Link to="/otra">ir a otra página</Link>
      </>
    )
  }
  const setup = () => {
    const router = createMemoryRouter(
      [
        { path: '/', element: <Page /> },
        { path: '/otra', element: <p>otra página</p> },
      ],
      { initialEntries: ['/'] },
    )
    render(<RouterProvider router={router} />)
    return router
  }

  it('pregunta antes de salir y "Seguir editando" se queda', async () => {
    const router = setup()
    await userEvent.click(screen.getByRole('link', { name: 'ir a otra página' }))
    expect(await screen.findByRole('dialog', { name: 'Tienes cambios sin guardar' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Seguir editando' }))
    expect(router.state.location.pathname).toBe('/')
  })

  it('"Salir sin guardar" navega y "Guardar y salir" guarda primero', async () => {
    let router = setup()
    await userEvent.click(screen.getByRole('link', { name: 'ir a otra página' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Salir sin guardar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/otra'))

    document.body.innerHTML = ''
    router = setup()
    await userEvent.click(screen.getByRole('link', { name: 'ir a otra página' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Guardar y salir' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/otra'))
  })
})

describe('H11 · progreso de subida', () => {
  it('informa el avance y termina en 100 %', async () => {
    const seen: number[] = []
    const file = new File([new Uint8Array(2048)], 'p.jpg', { type: 'image/jpeg' })
    const res = await api.createProject(file, 'x', undefined, (f) => seen.push(f))
    expect(res.id).toBe('prj_new')
    expect(seen.at(-1)).toBe(1)
  })

  it('traduce errores del servidor también por XHR', async () => {
    server.use(http.post('/api/projects', () => HttpResponse.json({ detail: 'muy grande' }, { status: 413 })))
    const file = new File(['x'], 'p.jpg', { type: 'image/jpeg' })
    await expect(api.createProject(file, 'x', undefined, () => undefined)).rejects.toMatchObject({ status: 413, message: 'muy grande' })
  })
})

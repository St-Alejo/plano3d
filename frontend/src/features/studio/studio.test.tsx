import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildActions } from '@/features/workspace/actions'
import { useEditor } from '@/store/editorStore'
import { StudioPage } from './StudioPage'

beforeEach(() => useEditor.getState().reset())

function renderStudio() {
  const router = createMemoryRouter(
    [
      { path: '/p/:id/estudio', element: <StudioPage /> },
      { path: '/p/:id', element: <p>pantalla del proyecto</p> },
    ],
    { initialEntries: ['/p/prj_1/estudio'] },
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('Estudio a pantalla completa', () => {
  it('abre el editor ocupando la ventana, con el panel de propiedades plegable', async () => {
    renderStudio()
    expect(await screen.findByTestId('studio')).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Herramientas del editor' })).toBeInTheDocument()
    const panel = screen.getByRole('button', { name: 'Panel de propiedades' })
    expect(screen.getByRole('tab', { name: 'Propiedades' })).toBeInTheDocument()
    await userEvent.click(panel)
    expect(screen.queryByRole('tab', { name: 'Propiedades' })).toBeNull()
    expect(panel).toHaveAttribute('aria-pressed', 'false')
  })

  it('el botón de salir vuelve a la página del proyecto', async () => {
    const { router } = renderStudio()
    await userEvent.click(await screen.findByRole('link', { name: 'Salir del estudio' }))
    expect(router.state.location.pathname).toBe('/p/prj_1')
  })
})

describe('acciones del estudio', () => {
  const base = { save: () => undefined, openPalette: () => undefined, openHelp: () => undefined, open3D: () => undefined }

  it('fuera del estudio, F lo abre; dentro, F alterna pantalla completa', () => {
    let opened = 0
    let full = 0
    const outside = buildActions({ ...base, studio: { open: () => opened++ } })
    const inside = buildActions({ ...base, studio: { fullscreen: () => full++, exit: () => undefined } })
    const f = new KeyboardEvent('keydown', { key: 'f' })
    outside.find((a) => a.match?.(f))!.run()
    inside.find((a) => a.match?.(f))!.run()
    expect([opened, full]).toEqual([1, 1])
    expect(inside.map((a) => a.id)).toContain('view.exitStudio')
  })
})

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { selectLevel, useEditor } from '@/store/editorStore'
import { sampleModel } from '@/test/fixtures'
import { GroupInspector } from './GroupInspector'
import { LayersPanel } from './LayersPanel'
import { StatusBar } from './StatusBar'

beforeEach(() => {
  useEditor.getState().reset()
  useEditor.getState().load('prj_1', sampleModel())
})

describe('LayersPanel', () => {
  it('oculta y bloquea capas con botones de alternancia accesibles', async () => {
    render(<LayersPanel />)
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar muros' }))
    expect(useEditor.getState().hiddenLayers.has('walls')).toBe(true)
    expect(screen.getByRole('button', { name: 'Mostrar muros' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Bloquear ambientes' }))
    expect(useEditor.getState().lockedLayers.has('rooms')).toBe(true)
    // el plano original solo se oculta: no tiene elementos que bloquear
    expect(screen.queryByRole('button', { name: 'Bloquear plano original' })).toBeNull()
  })
})

describe('StatusBar', () => {
  it('muestra cursor, zoom, imán, escala y selección', () => {
    render(<StatusBar hint="Pista" onHelp={() => undefined} />)
    expect(screen.getByText('x — · y —')).toBeInTheDocument()
    act(() => {
      useEditor.getState().setPointer({ x: 1.234, y: 5 }, 1.5)
      useEditor.getState().selectMany([
        { kind: 'wall', id: 'w_top' },
        { kind: 'wall', id: 'w_mid' },
      ])
    })
    expect(screen.getByText('x 1.23 · y 5.00 m')).toBeInTheDocument()
    expect(screen.getByText('150 %')).toBeInTheDocument()
    expect(screen.getByText('imán 5 cm')).toBeInTheDocument()
    expect(screen.getByText('escala estimada')).toBeInTheDocument()
    expect(screen.getByText('2 seleccionados')).toBeInTheDocument()
  })
})

describe('GroupInspector', () => {
  it('resume el grupo y elimina todo en un paso', async () => {
    act(() =>
      useEditor.getState().selectMany([
        { kind: 'wall', id: 'w_top' },
        { kind: 'wall', id: 'w_mid' },
      ]),
    )
    render(<GroupInspector />)
    expect(screen.getByRole('heading', { name: '2 elementos' })).toBeInTheDocument()
    expect(screen.getByText('17.00 m')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar selección' }))
    expect(selectLevel(useEditor.getState())!.walls.map((w) => w.id)).toEqual(['w_right', 'w_bottom', 'w_left'])
    expect(useEditor.getState().undoLabel).toBe('Eliminar 2 elementos')
  })
})

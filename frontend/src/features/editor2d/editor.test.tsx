import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { findLevel, findWall } from '@/domain/model'
import { useEditorShortcuts } from '@/features/workspace/useShortcuts'
import { sampleModel } from '@/test/fixtures'
import { useEditor } from '@/store/editorStore'
import { CalibrateDialog } from './CalibrateDialog'
import { PropertiesPanel } from './PropertiesPanel'
import { Toolbar } from './Toolbar'

const L = 'lvl_0'
const level = () => findLevel(useEditor.getState().model!, L)

beforeEach(() => {
  useEditor.getState().reset()
  useEditor.getState().load('prj_1', sampleModel())
})

describe('Toolbar', () => {
  it('marca la herramienta activa y cambia al hacer clic', async () => {
    render(<Toolbar />)
    expect(screen.getByRole('button', { name: 'Seleccionar' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Dibujar muro' }))
    expect(useEditor.getState().tool).toBe('wall')
    expect(screen.getByRole('button', { name: 'Dibujar muro' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('habilita deshacer solo cuando hay historial', async () => {
    render(<Toolbar />)
    expect(screen.getByRole('button', { name: 'Deshacer' })).toBeDisabled()
    act(() => useEditor.getState().select({ kind: 'room', id: 'r_b' }))
    render(<PropertiesPanel />)
    await userEvent.clear(screen.getByLabelText('Nombre'))
    await userEvent.type(screen.getByLabelText('Nombre'), 'Cocina')
    await userEvent.click(screen.getByRole('button', { name: 'Renombrar' }))
    const undo = screen.getByRole('button', { name: 'Deshacer: Renombrar ambiente' })
    expect(undo).toBeEnabled()
    await userEvent.click(undo)
    expect(level().rooms[1]!.label).toBe('Espacio 2')
  })
})

describe('PropertiesPanel', () => {
  it('resume el nivel y advierte escala estimada y baja confianza', () => {
    render(<PropertiesPanel />)
    expect(screen.getByText('Resumen')).toBeInTheDocument()
    expect(screen.getByText(/La escala es una estimación/)).toBeInTheDocument()
    expect(screen.getByText(/1 ambiente\(s\) con baja confianza/)).toBeInTheDocument()
  })

  it('edita la altura de un muro con un comando', async () => {
    act(() => useEditor.getState().select({ kind: 'wall', id: 'w_top' }))
    render(<PropertiesPanel />)
    const height = screen.getByLabelText('Altura')
    await userEvent.clear(height)
    await userEvent.type(height, '3,1{Enter}')
    expect(findWall(level(), 'w_top').height).toBeCloseTo(3.1)
    expect(useEditor.getState().undoLabel).toBe('Editar muro')
  })

  it('un valor inválido se descarta y no crea comando', async () => {
    act(() => useEditor.getState().select({ kind: 'wall', id: 'w_top' }))
    render(<PropertiesPanel />)
    const t = screen.getByLabelText('Grosor')
    await userEvent.clear(t)
    await userEvent.type(t, 'abc')
    await userEvent.tab()
    expect(t).toHaveValue('0.20')
    expect(useEditor.getState().canUndo).toBe(false)
  })

  it('convierte una puerta en ventana y la elimina', async () => {
    act(() => useEditor.getState().select({ kind: 'opening', id: 'o_door', wallId: 'w_mid' }))
    render(<PropertiesPanel />)
    expect(screen.getByRole('heading', { name: 'Puerta' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ventana' }))
    expect(findWall(level(), 'w_mid').openings[0]).toMatchObject({ kind: 'window', sill: 0.9 })
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar abertura' }))
    expect(findWall(level(), 'w_mid').openings).toHaveLength(0)
    expect(useEditor.getState().selection).toBeNull()
  })

  it('muestra el error del dominio si la edición es imposible', async () => {
    act(() => useEditor.getState().select({ kind: 'opening', id: 'o_door', wallId: 'w_mid' }))
    render(<PropertiesPanel />)
    const w = screen.getByLabelText('Ancho')
    await userEvent.clear(w)
    await userEvent.type(w, '40{Enter}')
    expect(useEditor.getState().error).toMatch(/se sale del muro/)
  })
})

describe('CalibrateDialog', () => {
  it('propone la medida actual y confirma la real', async () => {
    let meters = 0
    render(<CalibrateDialog line={{ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }} onConfirm={(m) => (meters = m)} onClose={() => undefined} />)
    const input = screen.getByLabelText('Medida real')
    expect(input).toHaveValue('10.00')
    await userEvent.clear(input)
    await userEvent.type(input, '12.5')
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar escala' }))
    expect(meters).toBe(12.5)
  })

  it('deshabilita aplicar con valores no positivos', async () => {
    render(<CalibrateDialog line={{ a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }} onConfirm={() => undefined} onClose={() => undefined} />)
    const input = screen.getByLabelText('Medida real')
    await userEvent.clear(input)
    await userEvent.type(input, '0')
    expect(screen.getByRole('button', { name: 'Aplicar escala' })).toBeDisabled()
  })
})

function ShortcutsHost({ onSave }: { onSave: () => void }) {
  useEditorShortcuts(onSave)
  return <input aria-label="campo" />
}

describe('atajos de teclado', () => {
  it('cambian de herramienta, deshacen/rehacen, borran y guardan', async () => {
    let saved = 0
    render(<ShortcutsHost onSave={() => (saved += 1)} />)
    await userEvent.keyboard('w')
    expect(useEditor.getState().tool).toBe('wall')
    await userEvent.keyboard('{Escape}')
    expect(useEditor.getState().tool).toBe('select')

    act(() => useEditor.getState().select({ kind: 'wall', id: 'w_right' }))
    await userEvent.keyboard('{Delete}')
    expect(level().walls.map((w) => w.id)).not.toContain('w_right')
    await userEvent.keyboard('{Control>}z{/Control}')
    expect(level().walls.map((w) => w.id)).toContain('w_right')
    await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(level().walls.map((w) => w.id)).not.toContain('w_right')
    await userEvent.keyboard('{Control>}s{/Control}')
    expect(saved).toBe(1)
  })

  it('se ignoran mientras se escribe en un campo', async () => {
    render(<ShortcutsHost onSave={() => undefined} />)
    await userEvent.type(screen.getByLabelText('campo'), 'w')
    expect(useEditor.getState().tool).toBe('select')
  })
})

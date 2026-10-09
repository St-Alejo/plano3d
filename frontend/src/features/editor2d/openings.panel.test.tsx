import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { findOpening } from '@/domain/openings'
import { selectLevel, useEditor } from '@/store/editorStore'
import { sampleModel } from '@/test/fixtures'
import { PropertiesPanel } from './PropertiesPanel'

const door = () => findOpening(selectLevel(useEditor.getState())!.walls, 'o_door')!

beforeEach(() => {
  useEditor.getState().reset()
  useEditor.getState().load('prj_1', sampleModel())
  act(() => useEditor.getState().select({ kind: 'opening', id: 'o_door', wallId: 'w_mid' }))
})

describe('inspector de puertas y ventanas', () => {
  it('pasa la puerta a otro muro desde la lista de muros, centrada', async () => {
    render(<PropertiesPanel />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Muro de la abertura' }), 'w_bottom')
    expect(door().wall.id).toBe('w_bottom')
    expect(door().opening.offset).toBeCloseTo((10 - 0.9) / 2, 1)
    expect(useEditor.getState().selection).toMatchObject({ kind: 'opening', wallId: 'w_bottom' })
  })

  it('escribe la distancia exacta desde el inicio del muro', async () => {
    render(<PropertiesPanel />)
    const field = screen.getByLabelText(/Distancia desde el inicio/)
    await userEvent.clear(field)
    await userEvent.type(field, '1,5{Enter}')
    expect(door().opening.offset).toBeCloseTo(1.5)
  })

  it('centrar e invertir el giro', async () => {
    render(<PropertiesPanel />)
    await userEvent.click(screen.getByRole('button', { name: 'Centrar' }))
    expect(door().opening.offset).toBeCloseTo((7 - 0.9) / 2)
    await userEvent.click(screen.getByRole('button', { name: /Invertir giro/ }))
    expect(door().opening.opens_left).toBe(false)
  })
})

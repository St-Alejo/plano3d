import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditor } from '@/store/editorStore'
import { sampleModel } from '@/test/fixtures'
import { AreaSchedulePanel } from './AreaSchedulePanel'

beforeEach(() => {
  useEditor.getState().reset()
  useEditor.getState().load('prj_1', sampleModel())
})

describe('AreaSchedulePanel', () => {
  it('lista los ambientes con su total y selecciona al hacer clic', async () => {
    render(<AreaSchedulePanel projectName="Depto centro" />)
    const table = screen.getByRole('table', { name: 'Cuadro de áreas' })
    // encabezado + 2 ambientes + total
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    await userEvent.click(within(table).getByRole('button', { name: 'Espacio 2' }))
    expect(useEditor.getState().selection).toMatchObject({ kind: 'room' })
  })

  it('descarga el CSV con el nombre del proyecto e imprime', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    render(<AreaSchedulePanel projectName="Depto Centro Ñuñoa" />)
    await userEvent.click(screen.getByRole('button', { name: 'CSV' }))
    expect(click).toHaveBeenCalledTimes(1)
    expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe('cuadro-de-areas-depto-centro-nunoa.csv')
    await userEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
    expect(print).toHaveBeenCalled()
    // la hoja de impresión existe fuera de la app
    expect(document.body.querySelector('.print-sheet')).not.toBeNull()
    click.mockRestore()
    print.mockRestore()
  })
})

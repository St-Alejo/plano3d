import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { searchCatalog } from '@/domain/catalog'
import { selectLevel, useEditor } from '@/store/editorStore'
import { sampleModel } from '@/test/fixtures'
import { buildActions, runShortcut } from './actions'
import { CatalogPanel } from './CatalogPanel'
import { deleteSelection, nudgeSelection } from './editActions'

const level = () => selectLevel(useEditor.getState())!
const noop = () => undefined

beforeEach(() => {
  useEditor.getState().reset()
  useEditor.getState().load('prj_1', sampleModel())
})

describe('catálogo y pincel', () => {
  it('busca sin tildes por nombre o categoría', () => {
    expect(searchCatalog('BANO').map((c) => c.id)).toEqual(['sanitario', 'lavamanos', 'ducha'])
    expect(searchCatalog('sofa').map((c) => c.id)).toEqual(['sofa_3', 'sofa_2'])
    expect(searchCatalog('').length).toBeGreaterThanOrEqual(20)
  })

  it('agrega al centro del plano, queda seleccionado y se mueve, gira y elimina', async () => {
    render(<CatalogPanel />)
    await userEvent.click(screen.getByRole('button', { name: 'Agregar Cama doble (1,40)' }))
    const [f] = level().furniture!
    expect(f!.position).toEqual({ x: 5, y: 3.5 })
    expect(useEditor.getState().selection).toEqual({ kind: 'furniture', id: f!.id })

    expect(nudgeSelection(0.05, 0)).toBe(true)
    expect(level().furniture![0]!.position.x).toBeCloseTo(5.05)
    const actions = buildActions({ save: noop, openPalette: noop, openHelp: noop, open3D: noop })
    expect(runShortcut(actions, new KeyboardEvent('keydown', { key: 'r' }))).toBe(true)
    expect(level().furniture![0]!.rotation).toBeCloseTo(Math.PI / 2)
    expect(deleteSelection()).toBe(true)
    expect(level().furniture).toEqual([])
  })

  it('el botón del pincel activa la herramienta y los acabados se eligen', async () => {
    render(<CatalogPanel />)
    await userEvent.click(screen.getByRole('button', { name: /Pintar/ }))
    expect(useEditor.getState().tool).toBe('paint')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Pisos' }), 'porcelanato')
    expect(useEditor.getState().brush.floor).toBe('porcelanato')
  })
})

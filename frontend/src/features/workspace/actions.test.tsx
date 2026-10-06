import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useEditor } from '@/store/editorStore'
import { sampleModel } from '@/test/fixtures'
import { buildActions, combo, runShortcut } from './actions'
import { CommandPalette, filterActions } from './CommandPalette'
import { ShortcutsHelp } from './ShortcutsHelp'

const key = (k: string, mods: Partial<KeyboardEventInit> = {}) => new KeyboardEvent('keydown', { key: k, ...mods })

describe('combo', () => {
  it('distingue modificadores', () => {
    expect(combo('mod+z')(key('z', { ctrlKey: true }))).toBe(true)
    expect(combo('mod+z')(key('z', { metaKey: true }))).toBe(true)
    expect(combo('mod+z')(key('z', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(combo('mod+shift+z')(key('Z', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(combo('w')(key('w', { ctrlKey: true }))).toBe(false)
    // "?" llega con Shift en casi todos los teclados: no se exige ni se rechaza
    expect(combo('?')(key('?', { shiftKey: true }))).toBe(true)
  })
})

describe('registro de acciones', () => {
  let saved = 0
  let palette = 0
  const actions = buildActions({
    save: () => (saved += 1),
    openPalette: () => (palette += 1),
    openHelp: () => undefined,
    open3D: () => undefined,
  })

  beforeEach(() => {
    saved = 0
    palette = 0
    useEditor.getState().reset()
    useEditor.getState().load('prj_1', sampleModel())
  })

  it('cada id es único y toda acción visible tiene nombre', () => {
    const ids = actions.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(actions.filter((a) => !a.hidden).every((a) => a.label.length > 0)).toBe(true)
  })

  it('runShortcut ejecuta la acción disponible y respeta enabled', () => {
    expect(runShortcut(actions, key('s', { ctrlKey: true }))).toBe(true)
    expect(saved).toBe(1)
    expect(runShortcut(actions, key('k', { ctrlKey: true }))).toBe(true)
    expect(palette).toBe(1)
    // sin historial, deshacer no está disponible: el atajo no se consume
    expect(runShortcut(actions, key('z', { ctrlKey: true }))).toBe(false)
    expect(runShortcut(actions, key('2'))).toBe(true)
    expect(useEditor.getState().viewMode).toBe('split')
    expect(runShortcut(actions, key('3'))).toBe(true)
    expect(useEditor.getState().viewMode).toBe('3d')
  })

  it('la paleta filtra sin tildes y oculta lo no disponible', () => {
    expect(filterActions(actions, 'cotas').map((a) => a.id)).toContain('view.dimensions')
    expect(filterActions(actions, 'vista 3d').map((a) => a.id)).toContain('view.3d')
    // sin selección no se ofrece eliminar ni copiar
    expect(filterActions(actions, '').map((a) => a.id)).not.toContain('edit.delete')
    useEditor.getState().select({ kind: 'wall', id: 'w_mid' })
    expect(filterActions(actions, 'elimin').map((a) => a.id)).toEqual(['edit.delete'])
    expect(filterActions(actions, '').some((a) => a.hidden)).toBe(false)
  })

  it('en la paleta se elige con flechas y se ejecuta con Enter', async () => {
    let open = true
    render(<CommandPalette open onOpenChange={(o) => (open = o)} actions={actions} />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Comando' }), 'solo la vista')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await userEvent.keyboard('{Enter}')
    expect(useEditor.getState().viewMode).toBe('3d')
    expect(open).toBe(false)
  })

  it('la ayuda lista los atajos del mismo registro', () => {
    render(<ShortcutsHelp open onOpenChange={() => undefined} actions={actions} />)
    expect(screen.getByRole('dialog', { name: 'Atajos de teclado' })).toBeInTheDocument()
    expect(screen.getByText('Duplicar')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+D')).toBeInTheDocument()
    expect(screen.getByText('Seleccionar por caja')).toBeInTheDocument()
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { AddDimension } from '@/domain/commands'
import { findWall } from '@/domain/model'
import { selectLevel, useEditor } from '@/store/editorStore'
import { sampleModel } from '@/test/fixtures'
import {
  canDelete,
  canPaste,
  copySelection,
  deleteSelection,
  duplicateSelection,
  nudgeSelection,
  paste,
  PASTE_OFFSET,
  selectAllWalls,
} from './editActions'

const level = () => selectLevel(useEditor.getState())!
const wallIds = () => level().walls.map((w) => w.id)

describe('multiselección en el store', () => {
  beforeEach(() => {
    useEditor.getState().reset()
    useEditor.getState().setClipboard([])
    useEditor.getState().load('prj_1', sampleModel())
  })

  it('Shift+clic agrega y quita; el último es el principal', () => {
    const s = useEditor.getState()
    s.select({ kind: 'wall', id: 'w_top' })
    s.toggleSelect({ kind: 'wall', id: 'w_mid' })
    expect(useEditor.getState().group).toHaveLength(2)
    expect(useEditor.getState().selection).toEqual({ kind: 'wall', id: 'w_mid' })
    s.toggleSelect({ kind: 'wall', id: 'w_mid' })
    expect(useEditor.getState().group).toEqual([{ kind: 'wall', id: 'w_top' }])
    expect(useEditor.getState().selection).toEqual({ kind: 'wall', id: 'w_top' })
  })

  it('cambiar de herramienta limpia la selección', () => {
    const s = useEditor.getState()
    selectAllWalls()
    expect(useEditor.getState().group).toHaveLength(5)
    s.setTool('wall')
    expect(useEditor.getState().group).toEqual([])
  })

  it('las capas se ocultan y bloquean por separado', () => {
    const s = useEditor.getState()
    s.toggleLayer('rooms', 'hidden')
    s.toggleLayer('walls', 'locked')
    expect([...useEditor.getState().hiddenLayers]).toEqual(['rooms'])
    expect([...useEditor.getState().lockedLayers]).toEqual(['walls'])
    s.toggleLayer('rooms', 'hidden')
    expect(useEditor.getState().hiddenLayers.size).toBe(0)
  })
})

describe('acciones sobre la selección', () => {
  beforeEach(() => {
    useEditor.getState().reset()
    useEditor.getState().setClipboard([])
    useEditor.getState().load('prj_1', sampleModel())
  })

  it('elimina varios elementos en un solo paso de deshacer', () => {
    const s = useEditor.getState()
    s.selectMany([
      { kind: 'wall', id: 'w_mid' },
      { kind: 'opening', id: 'o_win', wallId: 'w_top' },
    ])
    expect(canDelete()).toBe(true)
    expect(deleteSelection()).toBe(true)
    expect(wallIds()).not.toContain('w_mid')
    expect(findWall(level(), 'w_top').openings).toHaveLength(0)
    expect(useEditor.getState().undoLabel).toBe('Eliminar 2 elementos')
    useEditor.getState().undo()
    expect(wallIds()).toContain('w_mid')
    expect(findWall(level(), 'w_top').openings).toHaveLength(1)
  })

  it('una abertura de un muro que también se elimina no se borra dos veces', () => {
    const s = useEditor.getState()
    s.selectMany([
      { kind: 'opening', id: 'o_door', wallId: 'w_mid' },
      { kind: 'wall', id: 'w_mid' },
    ])
    expect(deleteSelection()).toBe(true)
    expect(useEditor.getState().undoLabel).toBe('Eliminar muro')
  })

  it('elimina también las cotas seleccionadas', () => {
    const s = useEditor.getState()
    const add = new AddDimension('lvl_0', { x: 0, y: 0 }, { x: 2, y: 0 })
    s.dispatch(add)
    s.selectMany([
      { kind: 'dimension', id: add.dimension.id },
      { kind: 'wall', id: 'w_mid' },
    ])
    expect(deleteSelection()).toBe(true)
    expect(level().dimensions).toEqual([])
    expect(wallIds()).not.toContain('w_mid')
  })

  it('mueve el grupo con las flechas', () => {
    const s = useEditor.getState()
    s.selectMany([{ kind: 'wall', id: 'w_mid' }])
    expect(nudgeSelection(0.05, 0)).toBe(true)
    expect(findWall(level(), 'w_mid').start.x).toBeCloseTo(6.05)
    s.select(null)
    expect(nudgeSelection(1, 0)).toBe(false)
  })

  it('copia, pega escalonado y duplica, dejando lo nuevo seleccionado', () => {
    const s = useEditor.getState()
    s.select({ kind: 'wall', id: 'w_mid' })
    expect(copySelection()).toBe(1)
    expect(canPaste()).toBe(true)
    expect(paste()).toBe(true)
    const first = level().walls.at(-1)!
    expect(first.start).toEqual({ x: 6 + PASTE_OFFSET, y: PASTE_OFFSET })
    expect(useEditor.getState().selection).toEqual({ kind: 'wall', id: first.id })
    expect(paste()).toBe(true)
    expect(level().walls.at(-1)!.start).toEqual({ x: 6 + 2 * PASTE_OFFSET, y: 2 * PASTE_OFFSET })
    expect(duplicateSelection()).toBe(true)
    expect(level().walls).toHaveLength(8)
    expect(useEditor.getState().undoLabel).toBe('Duplicar muro')
  })
})

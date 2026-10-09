import { beforeEach, describe, expect, it } from 'vitest'
import type { BuildingModel } from '@/api/types'
import { deleteSelection, nudgeSelection } from '@/features/workspace/editActions'
import { selectLevel, useEditor } from '@/store/editorStore'
import { sampleModel } from '@/test/fixtures'
import { CommandError, DeleteLevelItem, translateItem, UpdateLevelItem } from './commands'
import { findLevel } from './model'

const L = 'lvl_0'

function withItems(): BuildingModel {
  const m = sampleModel()
  const lv = m.levels[0]!
  lv.columns = [{ id: 'c1', center: { x: 3, y: 3 }, width: 0.3, depth: 0.3, rotation: 0, round: false, confidence: 1 }]
  lv.stairs = [{ id: 's1', start: { x: 7, y: 1 }, end: { x: 7, y: 4 }, width: 1, steps: 10, riser: 0.17, base: 0, confidence: 1 }]
  return m
}

describe('columnas y escaleras', () => {
  it('editar y deshacer una columna', () => {
    const m = withItems()
    const cmd = new UpdateLevelItem(L, 'columns', 'c1', { width: 0.5 })
    const after = cmd.execute(m)
    expect(findLevel(after, L).columns![0]!.width).toBe(0.5)
    expect(findLevel(cmd.undo(after), L).columns![0]!.width).toBe(0.3)
  })

  it('mover una escalera desplaza sus dos extremos', () => {
    const lv = findLevel(withItems(), L)
    const cmd = translateItem(L, { kind: 'stair', value: lv.stairs![0]! }, 0.5, -0.25)
    const s = findLevel(cmd.execute(withItems()), L).stairs![0]!
    expect(s.start).toEqual({ x: 7.5, y: 0.75 })
    expect(s.end).toEqual({ x: 7.5, y: 3.75 })
  })

  it('eliminar y deshacer conserva el orden', () => {
    const cmd = new DeleteLevelItem(L, 'stairs', 's1')
    const after = cmd.execute(withItems())
    expect(findLevel(after, L).stairs).toHaveLength(0)
    expect(findLevel(cmd.undo(after), L).stairs![0]!.id).toBe('s1')
  })

  it('rechaza medidas inválidas', () => {
    expect(() => new UpdateLevelItem(L, 'columns', 'c1', { width: 0 })).toThrow(CommandError)
    expect(() => new UpdateLevelItem(L, 'stairs', 's1', { steps: 0 })).toThrow(CommandError)
    expect(() => new UpdateLevelItem(L, 'columns', 'nada', { width: 1 }).execute(withItems())).toThrow(CommandError)
  })

  describe('desde la selección', () => {
    beforeEach(() => {
      useEditor.getState().reset()
      useEditor.getState().load('prj_1', withItems())
    })

    it('las flechas mueven la columna y Supr la borra', () => {
      useEditor.getState().select({ kind: 'column', id: 'c1' })
      nudgeSelection(0.05, 0)
      expect(selectLevel(useEditor.getState())!.columns![0]!.center.x).toBeCloseTo(3.05)
      deleteSelection()
      expect(selectLevel(useEditor.getState())!.columns).toHaveLength(0)
      useEditor.getState().undo()
      expect(selectLevel(useEditor.getState())!.columns).toHaveLength(1)
    })
  })
})

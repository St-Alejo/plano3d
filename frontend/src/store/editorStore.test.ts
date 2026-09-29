import { beforeEach, describe, expect, it } from 'vitest'
import { RelabelRoom, UpdateOpening, UpdateWall } from '@/domain/commands'
import { sampleModel } from '@/test/fixtures'
import { selectIsDirty, selectLevel, useEditor } from './editorStore'

const L = 'lvl_0'

describe('editorStore', () => {
  beforeEach(() => useEditor.getState().reset())

  it('carga un modelo limpio, sin cambios ni historial', () => {
    useEditor.getState().load('prj_1', sampleModel())
    const s = useEditor.getState()
    expect(s.projectId).toBe('prj_1')
    expect(selectIsDirty(s)).toBe(false)
    expect(s.canUndo).toBe(false)
    expect(selectLevel(s)?.id).toBe(L)
  })

  it('dispatch aplica el comando y marca cambios; undo/redo lo revierten', () => {
    const st = useEditor.getState()
    st.load('prj_1', sampleModel())
    expect(st.dispatch(new RelabelRoom(L, 'r_b', 'Cocina'))).toBe(true)
    let s = useEditor.getState()
    expect(selectIsDirty(s)).toBe(true)
    expect(s.undoLabel).toBe('Renombrar ambiente')
    s.undo()
    s = useEditor.getState()
    expect(selectLevel(s)?.rooms[1]?.label).toBe('Espacio 2')
    expect(s.canRedo).toBe(true)
    s.redo()
    expect(selectLevel(useEditor.getState())?.rooms[1]?.label).toBe('Cocina')
  })

  it('un comando inválido deja el modelo intacto y expone el error', () => {
    const st = useEditor.getState()
    st.load('prj_1', sampleModel())
    const before = useEditor.getState().model
    expect(st.dispatch(new UpdateOpening(L, 'w_mid', 'o_door', { width: 99 }))).toBe(false)
    const s = useEditor.getState()
    expect(s.model).toBe(before)
    expect(s.error).toMatch(/abertura/i)
    s.clearError()
    expect(useEditor.getState().error).toBeNull()
  })

  it('markSaved limpia el indicador de cambios', () => {
    const st = useEditor.getState()
    st.load('prj_1', sampleModel())
    st.dispatch(new UpdateWall(L, 'w_top', { height: 3 }))
    useEditor.getState().markSaved()
    expect(selectIsDirty(useEditor.getState())).toBe(false)
  })

  it('deshacer hasta el punto guardado deja el editor limpio; pasarlo lo ensucia', () => {
    const st = useEditor.getState()
    st.load('prj_1', sampleModel())
    st.dispatch(new UpdateWall(L, 'w_top', { height: 3 }))
    useEditor.getState().markSaved()
    useEditor.getState().dispatch(new RelabelRoom(L, 'r_a', 'Living'))
    expect(selectIsDirty(useEditor.getState())).toBe(true)
    useEditor.getState().undo()
    expect(selectIsDirty(useEditor.getState())).toBe(false)
    useEditor.getState().undo()
    expect(selectIsDirty(useEditor.getState())).toBe(true)
    useEditor.getState().redo()
    expect(selectIsDirty(useEditor.getState())).toBe(false)
  })

  it('cambiar de herramienta limpia la selección salvo en "select"', () => {
    const st = useEditor.getState()
    st.load('prj_1', sampleModel())
    st.select({ kind: 'wall', id: 'w_top' })
    st.setTool('select')
    expect(useEditor.getState().selection).not.toBeNull()
    st.setTool('door')
    expect(useEditor.getState().selection).toBeNull()
  })

  it('sin modelo, las acciones no hacen nada', () => {
    const st = useEditor.getState()
    expect(st.dispatch(new UpdateWall(L, 'w', { height: 3 }))).toBe(false)
    st.undo()
    st.redo()
    expect(useEditor.getState().model).toBeNull()
  })
})

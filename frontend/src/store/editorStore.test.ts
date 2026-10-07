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

describe('ambientes derivados en el store', () => {
  beforeEach(() => useEditor.getState().reset())

  it('mover un muro recalcula el área del ambiente y conserva su nombre', async () => {
    const { TranslateWall } = await import('@/domain/commands')
    const { polygonArea } = await import('@/domain/model')
    useEditor.getState().load('prj_1', sampleModel(), 1)
    useEditor.getState().dispatch(new TranslateWall(L, 'w_right', 1, 0))
    const cocina = selectLevel(useEditor.getState())!.rooms.find((r) => r.id === 'r_b')!
    expect(cocina.label).toBe('Espacio 2')
    expect(polygonArea(cocina.polygon)).toBeCloseTo(4.8 * 6.8, 6)
  })

  it('borrar un muro funde ambientes y deshacer recupera los nombres', async () => {
    const { DeleteWall, RelabelRoom } = await import('@/domain/commands')
    const st = useEditor.getState()
    st.load('prj_1', sampleModel(), 1)
    st.dispatch(new RelabelRoom(L, 'r_b', 'Cocina'))
    useEditor.getState().dispatch(new DeleteWall(L, 'w_mid'))
    expect(selectLevel(useEditor.getState())!.rooms).toHaveLength(1)
    useEditor.getState().undo()
    const labels = selectLevel(useEditor.getState())!.rooms.map((r) => r.label).sort()
    expect(labels).toEqual(['Cocina', 'Sala'])
  })

  it('cambios que no tocan muros no recalculan (renombrar mantiene el polígono)', async () => {
    const { RelabelRoom } = await import('@/domain/commands')
    useEditor.getState().load('prj_1', sampleModel(), 1)
    const before = selectLevel(useEditor.getState())!.rooms[0]!.polygon
    useEditor.getState().dispatch(new RelabelRoom(L, 'r_a', 'Living'))
    expect(selectLevel(useEditor.getState())!.rooms[0]!.polygon).toBe(before)
  })

  it('guardar actualiza la revisión y ajustes de rejilla/cotas', () => {
    const st = useEditor.getState()
    st.load('prj_1', sampleModel(), 4)
    expect(useEditor.getState().revision).toBe(4)
    st.markSaved(5)
    expect(useEditor.getState().revision).toBe(5)
    st.setGridStep(0.1)
    st.toggleDimensions()
    expect(useEditor.getState()).toMatchObject({ gridStep: 0.1, showDimensions: false })
  })
})

describe('guardado en segundo plano', () => {
  beforeEach(() => useEditor.getState().reset())

  it('lo editado mientras se guardaba queda pendiente', () => {
    const st = useEditor.getState()
    st.load('prj_1', sampleModel())
    st.dispatch(new RelabelRoom(L, 'r_b', 'Cocina'))
    const sent = useEditor.getState().head
    // llega otra edición antes de que responda el servidor
    st.dispatch(new RelabelRoom(L, 'r_b', 'Baño'))
    useEditor.getState().markSaved(7, sent)
    const s = useEditor.getState()
    expect(s.revision).toBe(7)
    expect(selectIsDirty(s)).toBe(true)
    // deshacer hasta lo enviado deja el editor limpio
    s.undo()
    expect(selectIsDirty(useEditor.getState())).toBe(false)
  })
})

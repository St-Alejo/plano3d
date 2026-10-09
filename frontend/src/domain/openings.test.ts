import { beforeEach, describe, expect, it } from 'vitest'
import { duplicateSelection, nudgeSelection, rotateSelection } from '@/features/workspace/editActions'
import { selectLevel, useEditor } from '@/store/editorStore'
import { sampleModel, wall, windowOp } from '@/test/fixtures'
import { CommandError, MoveOpening } from './commands'
import { findLevel } from './model'
import { centeredOffset, findOpening, placeOpening } from './openings'

const L = 'lvl_0'
const walls = (m = useEditor.getState().model!) => findLevel(m, L).walls
const where = (id: string, m = useEditor.getState().model!) => {
  const hit = findOpening(walls(m), id)!
  return { wall: hit.wall.id, offset: hit.opening.offset, opening: hit.opening }
}

describe('placeOpening', () => {
  const w = wall('w', 0, 0, 5, 0, [windowOp('o1', 2)]) // ventana de 2,0 a 3,2

  it('centra en el punto pedido, ajusta al paso y deja las distancias a los extremos', () => {
    const p = placeOpening(w, 0.9, 0.98)
    expect(p.offset).toBeCloseTo(0.55)
    expect(p.ok).toBe(true)
    expect(p.before).toBeCloseTo(0.55)
    expect(p.after).toBeCloseTo(5 - 0.55 - 0.9)
  })

  it('no se sale del muro: se recorta al extremo', () => {
    expect(placeOpening(w, 0.9, 4.9).offset).toBeCloseTo(4.1)
    expect(placeOpening(w, 0.9, -1).offset).toBe(0)
  })

  it('pisar otra abertura no cabe; la propia abertura no cuenta', () => {
    expect(placeOpening(w, 0.9, 2.5).ok).toBe(false)
    expect(placeOpening(w, 1.2, 2.7, 'o1').ok).toBe(true)
  })

  it('una abertura más ancha que el muro no cabe', () => {
    expect(placeOpening(wall('c', 0, 0, 0.6, 0), 0.9, 0.3).ok).toBe(false)
  })

  it('centeredOffset deja el mismo margen a cada lado', () => {
    expect(centeredOffset(w, 1)).toBeCloseTo(2)
  })
})

describe('MoveOpening', () => {
  it('corre la abertura dentro de su muro y se deshace', () => {
    const m = sampleModel()
    const cmd = new MoveOpening(L, 'o_door', 'w_mid', 5)
    const moved = cmd.execute(m)
    expect(where('o_door', moved)).toMatchObject({ wall: 'w_mid', offset: 5 })
    expect(where('o_door', cmd.undo(moved))).toMatchObject({ wall: 'w_mid', offset: 3 })
  })

  it('pasa la puerta a otro muro conservando sus medidas, y deshacer la devuelve', () => {
    const m = sampleModel()
    const cmd = new MoveOpening(L, 'o_door', 'w_bottom', 1)
    const moved = cmd.execute(m)
    const now = where('o_door', moved)
    expect(now).toMatchObject({ wall: 'w_bottom', offset: 1 })
    expect(now.opening).toMatchObject({ kind: 'door', width: 0.9, height: 2.1 })
    expect(findLevel(moved, L).walls.find((w) => w.id === 'w_mid')!.openings).toHaveLength(0)
    const back = cmd.undo(moved)
    expect(where('o_door', back)).toMatchObject({ wall: 'w_mid', offset: 3 })
    expect(findLevel(back, L).walls.find((w) => w.id === 'w_bottom')!.openings).toHaveLength(0)
  })

  it('rechaza un lugar donde no cabe', () => {
    expect(() => new MoveOpening(L, 'o_door', 'w_top', 2.2).execute(sampleModel())).toThrow(CommandError)
    expect(() => new MoveOpening(L, 'o_door', 'w_top', 9.5).execute(sampleModel())).toThrow(CommandError)
    expect(() => new MoveOpening(L, 'nada', 'w_top', 1).execute(sampleModel())).toThrow(CommandError)
  })
})

describe('acciones sobre aberturas', () => {
  beforeEach(() => {
    useEditor.getState().reset()
    useEditor.getState().load('prj_1', sampleModel())
  })

  it('las flechas corren la ventana por su muro (en un muro horizontal, ← y →)', () => {
    useEditor.getState().select({ kind: 'opening', id: 'o_win', wallId: 'w_top' })
    nudgeSelection(0.25, 0)
    expect(where('o_win').offset).toBeCloseTo(2.25)
    nudgeSelection(0, 0.25) // perpendicular al muro: no hace nada
    expect(where('o_win').offset).toBeCloseTo(2.25)
    useEditor.getState().undo()
    expect(where('o_win').offset).toBeCloseTo(2)
  })

  it('R recorre las cuatro formas de abrir la puerta', () => {
    useEditor.getState().select({ kind: 'opening', id: 'o_door', wallId: 'w_mid' })
    const seen: [boolean | null | undefined, boolean | null | undefined][] = []
    for (let i = 0; i < 4; i++) {
      rotateSelection()
      const o = where('o_door').opening
      seen.push([o.opens_left, o.hinge_at_end])
    }
    expect(new Set(seen.map((x) => `${x[0] ?? true}/${x[1] ?? false}`)).size).toBe(4)
  })

  it('Ctrl+D duplica la abertura al lado, en el mismo muro', () => {
    useEditor.getState().select({ kind: 'opening', id: 'o_door', wallId: 'w_mid' })
    expect(duplicateSelection()).toBe(true)
    const mid = selectLevel(useEditor.getState())!.walls.find((w) => w.id === 'w_mid')!
    expect(mid.openings).toHaveLength(2)
    const sel = useEditor.getState().selection
    expect(sel).toMatchObject({ kind: 'opening', wallId: 'w_mid' })
    expect(sel!.id).not.toBe('o_door')
    expect(walls().length).toBe(5)
  })
})

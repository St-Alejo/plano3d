import { describe, expect, it } from 'vitest'
import { sampleModel } from '@/test/fixtures'
import {
  AddOpening,
  AddWall,
  CalibrateScale,
  CommandError,
  CommandHistory,
  DeleteOpening,
  DeleteWall,
  MoveWallEndpoint,
  RelabelRoom,
  UpdateOpening,
  UpdateWall,
  type Command,
} from './commands'
import { findLevel, findWall, totalArea, wallLength } from './model'

const L = 'lvl_0'
const walls = (m = sampleModel()) => findLevel(m, L).walls

/** Propiedad central del patrón Command: execute + undo deja todo como estaba. */
function roundTrip(cmd: Command) {
  const original = sampleModel()
  const after = cmd.execute(original)
  expect(after).not.toEqual(original)
  expect(cmd.undo(after)).toEqual(original)
  return after
}

describe('cada comando es reversible', () => {
  it('MoveWallEndpoint', () => {
    const m = roundTrip(new MoveWallEndpoint(L, 'w_right', 'end', { x: 10, y: 8 }))
    expect(findWall(findLevel(m, L), 'w_right').end).toEqual({ x: 10, y: 8 })
  })
  it('UpdateWall', () => {
    const m = roundTrip(new UpdateWall(L, 'w_top', { height: 3 }))
    expect(findWall(findLevel(m, L), 'w_top').height).toBe(3)
  })
  it('AddOpening centra la abertura en el clic y la mantiene dentro del muro', () => {
    const cmd = new AddOpening(L, 'w_right', 'door', 0.1, 7)
    const m = roundTrip(cmd)
    const op = findWall(findLevel(m, L), 'w_right').openings[0]!
    expect(op.offset).toBe(0)
    expect(op.width).toBe(0.9)
    expect(new AddOpening(L, 'w_right', 'window', 6.9, 7).opening.offset).toBeCloseTo(5.8)
  })
  it('UpdateOpening / DeleteOpening', () => {
    roundTrip(new UpdateOpening(L, 'w_mid', 'o_door', { width: 1.1 }))
    const m = roundTrip(new DeleteOpening(L, 'w_mid', 'o_door'))
    expect(findWall(findLevel(m, L), 'w_mid').openings).toEqual([])
  })
  it('AddWall / DeleteWall (vuelve a su posición original)', () => {
    const add = new AddWall(L, { x: 0, y: 3 }, { x: 6, y: 3 })
    expect(walls(roundTrip(add))).toHaveLength(6)
    const del = new DeleteWall(L, 'w_right')
    const m = roundTrip(del)
    expect(walls(m).map((w) => w.id)).not.toContain('w_right')
  })
  it('RelabelRoom sube la confianza a 1', () => {
    const m = roundTrip(new RelabelRoom(L, 'r_b', '  Cocina '))
    const room = findLevel(m, L).rooms.find((r) => r.id === 'r_b')!
    expect(room.label).toBe('Cocina')
    expect(room.confidence).toBe(1)
  })
  it('CalibrateScale', () => {
    // el muro superior mide 10 m en el modelo; en realidad mide 12 m
    const m = roundTrip(new CalibrateScale({ x: 0, y: 0 }, { x: 10, y: 0 }, 12))
    expect(wallLength(findWall(findLevel(m, L), 'w_top'))).toBeCloseTo(12)
    expect(totalArea(m)).toBeCloseTo(totalArea(sampleModel()) * 1.44)
  })
})

describe('los comandos inválidos no alteran el modelo', () => {
  it.each([
    ['abertura más ancha que el muro', () => new UpdateOpening(L, 'w_mid', 'o_door', { width: 50 })],
    ['muro de largo cero', () => new MoveWallEndpoint(L, 'w_top', 'end', { x: 0, y: 0 })],
    ['abertura inexistente', () => new DeleteOpening(L, 'w_mid', 'nope')],
    ['muro inexistente', () => new DeleteWall(L, 'nope')],
    ['nombre vacío', () => new RelabelRoom(L, 'r_a', '   ')],
    ['ambiente inexistente', () => new RelabelRoom(L, 'nope', 'x')],
  ])('%s', (_n, make) => {
    const history = new CommandHistory()
    const m = sampleModel()
    expect(() => history.execute(make(), m)).toThrow()
    expect(history.canUndo).toBe(false)
  })

  it('constructores que validan', () => {
    expect(() => new AddWall(L, { x: 0, y: 0 }, { x: 0, y: 0 })).toThrow(CommandError)
    expect(() => new CalibrateScale({ x: 0, y: 0 }, { x: 0, y: 0 }, 3)).toThrow(CommandError)
    expect(() => new CalibrateScale({ x: 0, y: 0 }, { x: 1, y: 0 }, 0)).toThrow(CommandError)
  })
})

describe('CommandHistory', () => {
  it('deshacer y rehacer en orden, y un comando nuevo borra el futuro', () => {
    const h = new CommandHistory()
    let m = sampleModel()
    m = h.execute(new UpdateWall(L, 'w_top', { height: 3 }), m)
    m = h.execute(new RelabelRoom(L, 'r_a', 'Living'), m)
    expect(h.undoLabel).toBe('Renombrar ambiente')

    m = h.undo(m)
    expect(findLevel(m, L).rooms[0]!.label).toBe('Sala')
    expect(h.canRedo).toBe(true)
    expect(h.redoLabel).toBe('Renombrar ambiente')
    m = h.redo(m)
    expect(findLevel(m, L).rooms[0]!.label).toBe('Living')

    m = h.undo(h.undo(m))
    expect(m).toEqual(sampleModel())
    expect(h.undo(m)).toBe(m) // nada que deshacer

    m = h.redo(m)
    m = h.execute(new UpdateWall(L, 'w_left', { thickness: 0.3 }), m)
    expect(h.canRedo).toBe(false)
    expect(h.redo(m)).toBe(m)
    h.clear()
    expect(h.canUndo).toBe(false)
  })

  it('respeta el límite de historial', () => {
    const h = new CommandHistory(3)
    let m = sampleModel()
    for (const height of [2.7, 2.8, 2.9, 3.0, 3.1]) m = h.execute(new UpdateWall(L, 'w_top', { height }), m)
    m = h.undo(h.undo(h.undo(m)))
    expect(h.canUndo).toBe(false)
    expect(findWall(findLevel(m, L), 'w_top').height).toBe(2.8)
  })

  it('deshacer una edición no pisa ediciones posteriores de otros muros', () => {
    const h = new CommandHistory()
    const a = new UpdateWall(L, 'w_top', { height: 3 })
    let m = h.execute(a, sampleModel())
    m = h.execute(new UpdateWall(L, 'w_left', { height: 2.9 }), m)
    m = a.undo(m)
    expect(findWall(findLevel(m, L), 'w_left').height).toBe(2.9)
    expect(findWall(findLevel(m, L), 'w_top').height).toBe(2.6)
  })
})

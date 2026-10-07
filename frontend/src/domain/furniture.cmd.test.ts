import { describe, expect, it } from 'vitest'
import { sampleModel } from '@/test/fixtures'
import {
  AddFurniture,
  CommandError,
  DeleteFurniture,
  SetFloorMaterial,
  SetWallMaterial,
  UpdateFurniture,
} from './commands'
import { findLevel, findWall } from './model'

const L = 'lvl_0'

describe('comandos de mobiliario', () => {
  it('agrega con medidas de catálogo, mueve, gira y se deshace', () => {
    const m = sampleModel()
    const add = new AddFurniture(L, 'cama_doble', { x: 3, y: 3 })
    const a = add.execute(m)
    const [f] = findLevel(a, L).furniture!
    expect(f).toMatchObject({ catalog_id: 'cama_doble', width: 1.4, rotation: 0, position: { x: 3, y: 3 } })
    expect(add.label).toBe('Agregar cama doble (1,40)')

    const move = new UpdateFurniture(L, f!.id, { position: { x: 4, y: 2 }, rotation: Math.PI / 2 })
    const b = move.execute(a)
    expect(findLevel(b, L).furniture![0]).toMatchObject({ position: { x: 4, y: 2 }, rotation: Math.PI / 2 })
    expect(move.undo(b)).toEqual(a)
    expect(add.undo(a)).toEqual({ ...m, levels: [{ ...m.levels[0]!, furniture: [] }] })
  })

  it('rechaza piezas inexistentes y medidas no positivas', () => {
    expect(() => new AddFurniture(L, 'nave_espacial', { x: 0, y: 0 })).toThrow(CommandError)
    expect(() => new UpdateFurniture(L, 'f', { width: 0 })).toThrow(CommandError)
    expect(() => new UpdateFurniture(L, 'no', { rotation: 1 }).execute(sampleModel())).toThrow(CommandError)
  })

  it('DeleteFurniture se deshace en su posición', () => {
    let m = sampleModel()
    const a = new AddFurniture(L, 'silla', { x: 1, y: 1 })
    const b = new AddFurniture(L, 'escritorio', { x: 2, y: 1 })
    m = b.execute(a.execute(m))
    const del = new DeleteFurniture(L, a.furniture.id)
    const after = del.execute(m)
    expect(findLevel(after, L).furniture!.map((f) => f.id)).toEqual([b.furniture.id])
    expect(del.undo(after)).toEqual(m)
  })
})

describe('comandos de acabados', () => {
  it('pinta varios muros y deshace cada uno a su acabado anterior', () => {
    const m = sampleModel()
    const paint = new SetWallMaterial(L, ['w_top', 'w_mid'], 'ladrillo')
    const after = paint.execute(m)
    expect(findWall(findLevel(after, L), 'w_top').material).toBe('ladrillo')
    expect(findWall(findLevel(after, L), 'w_right').material).toBe('plaster')
    expect(paint.label).toBe('Cambiar acabado de 2 muros')
    expect(paint.undo(after)).toEqual(m)
    expect(() => new SetWallMaterial(L, ['nada'], 'ladrillo').execute(m)).toThrow()
  })

  it('cambia el piso de un ambiente y vuelve al de su tipo al deshacer', () => {
    const m = sampleModel()
    const cmd = new SetFloorMaterial(L, 'r_a', 'porcelanato')
    const after = cmd.execute(m)
    expect(findLevel(after, L).rooms.find((r) => r.id === 'r_a')!.floor_material).toBe('porcelanato')
    const back = cmd.undo(after)
    expect(findLevel(back, L).rooms.find((r) => r.id === 'r_a')!.floor_material ?? null).toBeNull()
  })
})

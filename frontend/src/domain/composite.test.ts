import { describe, expect, it } from 'vitest'
import { sampleModel } from '@/test/fixtures'
import { cloneWalls, CommandError, CompositeCommand, DeleteWall, InsertWalls, TranslateWalls } from './commands'
import { findLevel, findWall } from './model'

const L = 'lvl_0'

describe('CompositeCommand', () => {
  it('aplica y deshace varias ediciones como una sola', () => {
    const m = sampleModel()
    const cmd = new CompositeCommand('Eliminar 2 muros', [new DeleteWall(L, 'w_mid'), new DeleteWall(L, 'w_top')])
    const after = cmd.execute(m)
    expect(findLevel(after, L).walls.map((w) => w.id)).toEqual(['w_right', 'w_bottom', 'w_left'])
    expect(cmd.undo(after)).toEqual(m)
  })

  it('si una parte falla, revierte las anteriores y propaga el error', () => {
    const m = sampleModel()
    const cmd = new CompositeCommand('x', [new DeleteWall(L, 'w_mid'), new DeleteWall(L, 'no_existe')])
    expect(() => cmd.execute(m)).toThrow(CommandError)
    expect(() => new CompositeCommand('vacío', [])).toThrow(CommandError)
  })
})

describe('TranslateWalls', () => {
  it('mueve las esquinas compartidas una sola vez y estira a los vecinos', () => {
    const m = sampleModel()
    // w_top (0,0)-(10,0) y w_right (10,0)-(10,7) comparten la esquina (10,0)
    const after = new TranslateWalls(L, ['w_top', 'w_right'], 0.5, 0).execute(m)
    const lv = findLevel(after, L)
    expect(findWall(lv, 'w_top').start).toEqual({ x: 0.5, y: 0 })
    expect(findWall(lv, 'w_top').end).toEqual({ x: 10.5, y: 0 })
    expect(findWall(lv, 'w_right').end).toEqual({ x: 10.5, y: 7 })
    // el muro de la izquierda sigue a la esquina (0,0) que se movió
    expect(findWall(lv, 'w_left').end).toEqual({ x: 0.5, y: 0 })
  })

  it('se deshace sin tocar otros muros', () => {
    const m = sampleModel()
    const cmd = new TranslateWalls(L, ['w_mid'], 1, 0)
    expect(cmd.undo(cmd.execute(m))).toEqual(m)
    expect(cmd.label).toBe('Mover muro')
    expect(new TranslateWalls(L, ['a', 'b'], 0, 0).label).toBe('Mover 2 muros')
  })
})

describe('copiar y pegar muros', () => {
  it('clona con ids nuevos, aberturas incluidas, desplazado', () => {
    const src = findLevel(sampleModel(), L).walls.filter((w) => w.id === 'w_mid')
    const [copy] = cloneWalls(src, 1, 2)
    expect(copy!.id).not.toBe('w_mid')
    expect(copy!.start).toEqual({ x: 7, y: 2 })
    expect(copy!.openings).toHaveLength(1)
    expect(copy!.openings[0]!.id).not.toBe(src[0]!.openings[0]!.id)
  })

  it('InsertWalls agrega y deshace exactamente lo pegado', () => {
    const m = sampleModel()
    const copies = cloneWalls(findLevel(m, L).walls.slice(0, 2), 0.5, 0.5)
    const cmd = new InsertWalls(L, copies)
    const after = cmd.execute(m)
    expect(findLevel(after, L).walls).toHaveLength(7)
    expect(cmd.label).toBe('Pegar 2 muros')
    expect(cmd.undo(after)).toEqual(m)
  })
})

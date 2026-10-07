import { describe, expect, it } from 'vitest'
import { sampleModel } from '@/test/fixtures'
import { AddDimension, CommandError, DeleteDimension, DIMENSION_OFFSET } from './commands'
import { findLevel } from './model'

const L = 'lvl_0'

describe('cotas de usuario', () => {
  it('AddDimension mide la distancia y queda como cota manual exacta', () => {
    const m = sampleModel()
    const cmd = new AddDimension(L, { x: 0, y: 0 }, { x: 3, y: 4 })
    const after = cmd.execute(m)
    const [d] = findLevel(after, L).dimensions!
    expect(d).toMatchObject({ value: 5, measured: 5, text: '5,00', source: 'manual', status: 'exact', offset: DIMENSION_OFFSET })
    expect(cmd.undo(after)).toEqual({ ...m, levels: [{ ...m.levels[0]!, dimensions: [] }] })
  })

  it('rechaza cotas de un clic', () => {
    expect(() => new AddDimension(L, { x: 1, y: 1 }, { x: 1.01, y: 1 })).toThrow(CommandError)
  })

  it('DeleteDimension se deshace en su misma posición', () => {
    let m = sampleModel()
    const a = new AddDimension(L, { x: 0, y: 0 }, { x: 1, y: 0 })
    const b = new AddDimension(L, { x: 0, y: 0 }, { x: 2, y: 0 })
    m = b.execute(a.execute(m))
    const del = new DeleteDimension(L, a.dimension.id)
    const after = del.execute(m)
    expect(findLevel(after, L).dimensions!.map((d) => d.id)).toEqual([b.dimension.id])
    expect(del.undo(after)).toEqual(m)
    expect(() => new DeleteDimension(L, 'nada').execute(m)).toThrow(CommandError)
  })
})

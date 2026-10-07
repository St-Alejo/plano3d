import { describe, expect, it } from 'vitest'
import { snapWithGuides } from './snap'

const corners = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 3 },
]

describe('snapWithGuides', () => {
  it('sobre una esquina existente se pega a ella, sin guías', () => {
    expect(snapWithGuides({ x: 4.05, y: 2.95 }, { candidates: corners, tol: 0.1 })).toEqual({ point: { x: 4, y: 3 }, guides: [] })
  })

  it('alinea en vertical y horizontal con esquinas lejanas y devuelve las guías', () => {
    const r = snapWithGuides({ x: 3.96, y: 6.02 }, { candidates: corners, tol: 0.1 })
    expect(r.point).toEqual({ x: 4, y: 6.02 })
    expect(r.guides).toHaveLength(1)
    expect(r.guides[0]!.from.x).toBe(4)
    const both = snapWithGuides({ x: 7.95, y: 3.04 }, { candidates: [{ x: 8, y: -5 }, ...corners], tol: 0.1 })
    expect(both.point).toEqual({ x: 8, y: 3 })
    expect(both.guides).toHaveLength(2)
  })

  it('no rompe el eje fijado respecto del ancla y no se alinea consigo misma', () => {
    // ancla (0,0) y punto casi horizontal: y queda fija en 0; x se alinea con la esquina x=4
    const r = snapWithGuides({ x: 3.95, y: 0.2 }, { anchor: { x: 0, y: 0 }, candidates: [{ x: 4, y: 3 }, { x: 0, y: 0 }], tol: 0.1 })
    expect(r.point).toEqual({ x: 4, y: 0 })
    expect(r.guides.map((g) => g.from)).toEqual([{ x: 4, y: 3 }])
  })

  it('sin alineación, el eje libre va a la rejilla', () => {
    const r = snapWithGuides({ x: 10.07, y: 9.93 }, { candidates: corners, tol: 0.05, grid: 0.5 })
    expect(r).toEqual({ point: { x: 10, y: 10 }, guides: [] })
  })
})

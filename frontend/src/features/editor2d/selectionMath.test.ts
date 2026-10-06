import { describe, expect, it } from 'vitest'
import { sampleModel, wall } from '@/test/fixtures'
import { contentBounds, parseLength, wallsInBox } from './selectionMath'

describe('wallsInBox', () => {
  const walls = [wall('a', 0, 0, 2, 0), wall('b', 1, 1, 3, 1), wall('c', 5, 5, 6, 6), wall('d', -2, 0.5, 9, 0.5)]
  it('de izquierda a derecha ("ventana"): solo muros completamente dentro', () => {
    expect(wallsInBox(walls, { x: -1, y: -1 }, { x: 3.5, y: 2 }).map((w) => w.id)).toEqual(['a', 'b'])
    expect(wallsInBox(walls, { x: 0.5, y: -1 }, { x: 4, y: 2 }).map((w) => w.id)).toEqual(['b'])
  })
  it('de derecha a izquierda ("cruce"): también los que la caja toca', () => {
    expect(wallsInBox(walls, { x: 4, y: 2 }, { x: 0.5, y: -1 }).map((w) => w.id)).toEqual(['a', 'b', 'd'])
    // el muro "d" atraviesa la caja sin tener extremos dentro
    expect(wallsInBox(walls, { x: 1.5, y: 0.8 }, { x: 0.5, y: 0.2 }).map((w) => w.id)).toEqual(['d'])
    expect(wallsInBox(walls, { x: 4.5, y: 4 }, { x: 4, y: 3 })).toEqual([])
  })
})

describe('parseLength', () => {
  it.each([
    ['3,5', 3.5],
    ['3.50', 3.5],
    ['350cm', 3.5],
    ['2 m', 2],
    ['.8', 0.8],
  ])('%s → %s m', (txt, m) => expect(parseLength(txt)).toBeCloseTo(m))
  it.each(['', 'abc', '0', '-2', '3,5,1'])('rechaza %j', (txt) => expect(parseLength(txt)).toBeNull())
})

describe('contentBounds', () => {
  it('encuadra los muros, no la imagen completa', () => {
    const b = contentBounds(sampleModel())!
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([0, 0, 10, 7])
    expect(contentBounds(null)).toBeNull()
  })
})

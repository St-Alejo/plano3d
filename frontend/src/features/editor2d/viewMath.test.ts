import { describe, expect, it } from 'vitest'
import { MAX_SCALE, MIN_SCALE, pinchOf, pinchStep, zoomAt } from './viewMath'

const world = (v: { scale: number; x: number; y: number }, p: { x: number; y: number }) => ({
  x: (p.x - v.x) / v.scale,
  y: (p.y - v.y) / v.scale,
})

describe('zoomAt', () => {
  it('el punto bajo el cursor queda fijo al hacer zoom', () => {
    const v = { scale: 1.5, x: 30, y: -20 }
    const at = { x: 200, y: 150 }
    const z = zoomAt(v, at, 2)
    expect(z.scale).toBe(3)
    expect(world(z, at).x).toBeCloseTo(world(v, at).x)
    expect(world(z, at).y).toBeCloseTo(world(v, at).y)
  })

  it('respeta los límites de escala', () => {
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, { x: 0, y: 0 }, 1000).scale).toBe(MAX_SCALE)
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, { x: 0, y: 0 }, 0.00001).scale).toBe(MIN_SCALE)
  })
})

describe('pellizco', () => {
  it('abrir los dedos al doble duplica la escala alrededor del centro', () => {
    const v = { scale: 1, x: 0, y: 0 }
    const prev = pinchOf({ x: 100, y: 100 }, { x: 200, y: 100 })
    const next = pinchOf({ x: 50, y: 100 }, { x: 250, y: 100 })
    const r = pinchStep(v, prev, next)
    expect(r.scale).toBeCloseTo(2)
    expect(world(r, next.center).x).toBeCloseTo(world(v, prev.center).x)
  })

  it('mover los dos dedos juntos desplaza sin cambiar la escala', () => {
    const v = { scale: 2, x: 10, y: 10 }
    const prev = pinchOf({ x: 100, y: 100 }, { x: 200, y: 100 })
    const next = pinchOf({ x: 130, y: 140 }, { x: 230, y: 140 })
    expect(pinchStep(v, prev, next)).toEqual({ scale: 2, x: 40, y: 50 })
  })

  it('ignora dedos superpuestos (distancia ~0)', () => {
    const v = { scale: 1, x: 0, y: 0 }
    const p = pinchOf({ x: 5, y: 5 }, { x: 5, y: 5 })
    expect(pinchStep(v, p, pinchOf({ x: 0, y: 0 }, { x: 100, y: 0 }))).toBe(v)
  })
})

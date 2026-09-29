import { describe, expect, it } from 'vitest'
import { sampleModel } from '@/test/fixtures'
import { nearestWall, snapPoint, snapToAxis, snapToPoints, wallEndpoints } from './snap'

const level = sampleModel().levels[0]!

describe('snap', () => {
  it('imán a extremos dentro de la tolerancia', () => {
    const pts = wallEndpoints(level.walls)
    expect(snapToPoints({ x: 9.9, y: 0.1 }, pts, 0.3)).toEqual({ point: { x: 10, y: 0 }, snapped: true })
    expect(snapToPoints({ x: 5, y: 5 }, pts, 0.3).snapped).toBe(false)
  })

  it('excluye los extremos del propio muro', () => {
    const pts = wallEndpoints(level.walls, 'w_top')
    expect(pts).toHaveLength(8)
  })

  it('endereza a horizontal o vertical', () => {
    expect(snapToAxis({ x: 0, y: 0 }, { x: 5, y: 0.2 })).toEqual({ x: 5, y: 0 })
    expect(snapToAxis({ x: 0, y: 0 }, { x: -0.2, y: 5 })).toEqual({ x: 0, y: 5 })
    expect(snapToAxis({ x: 0, y: 0 }, { x: 3, y: 3 })).toEqual({ x: 3, y: 3 })
  })

  it('los extremos tienen prioridad sobre los ejes', () => {
    const p = snapPoint({ x: 6.1, y: 6.95 }, { anchor: { x: 0, y: 0 }, candidates: [{ x: 6, y: 7 }], tol: 0.3 })
    expect(p).toEqual({ x: 6, y: 7 })
    expect(snapPoint({ x: 4, y: 0.1 }, { anchor: { x: 0, y: 0 }, candidates: [], tol: 0.3 })).toEqual({ x: 4, y: 0 })
    expect(snapPoint({ x: 4, y: 3 }, { candidates: [], tol: 0.3 })).toEqual({ x: 4, y: 3 })
  })

  it('encuentra el muro más cercano y el offset del clic', () => {
    const hit = nearestWall(level, { x: 6.05, y: 3.2 }, 0.3)
    expect(hit?.wall.id).toBe('w_mid')
    expect(hit?.offset).toBeCloseTo(3.2)
    expect(nearestWall(level, { x: 3, y: 3 }, 0.3)).toBeNull()
  })
})

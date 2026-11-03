import { describe, expect, it } from 'vitest'
import type { BuildingModel } from '@/api/types'
import opc3 from '@/test/opc3.json'
import { SLAB_THICKNESS } from '@/features/viewer3d/scene/SceneBuilder'
import { buildWalkWorld, EYE_HEIGHT, levelArrival, spawnAt, stairRoute, stepCharacter, type CharacterState, type WalkWorld } from './walkPhysics'

/** La casa Opción 3: 3 pisos (0 / 2,6 / 5,2 m) con la escalera en U de tres tramos en cada piso. */
const model = opc3 as unknown as BuildingModel
const world = buildWalkWorld(model)
const [p1, p2, p3] = world.levels

/** Sigue los puntos a 2,2 m/s; devuelve el estado y la altura mínima libre sobre los ojos. */
function follow(w: WalkWorld, s: CharacterState, points: { x: number; y: number }[]) {
  let st = s
  let headroom = Infinity
  for (const to of points)
    for (let i = 0; i < 6 * 60; i++) {
      const dx = to.x - st.x
      const dz = to.y - st.z
      const d = Math.hypot(dx, dz)
      if (d < 0.05) break
      const step = Math.min(d, 2.2 / 60)
      st = stepCharacter(st, { dx: (dx / d) * step, dz: (dz / d) * step }, 1 / 60, w)
      headroom = Math.min(headroom, ceilingAbove(w, st) - (st.y + EYE_HEIGHT))
    }
  return { st, headroom }
}

/** Cara inferior de la losa más baja sobre la persona (sin hueco en ese punto). */
function ceilingAbove(w: WalkWorld, s: CharacterState): number {
  let best = Infinity
  for (const lv of w.levels) {
    const under = lv.elevation - SLAB_THICKNESS - 0.05
    if (under <= s.y + 0.1) continue
    const b = lv.bounds
    if (!b || s.x < b.minX || s.x > b.maxX || s.z < b.minY || s.z > b.maxY) continue
    const h = lv.hole
    if (h && s.x >= h.minX && s.x <= h.maxX && s.z >= h.minY && s.z <= h.maxY) continue
    best = Math.min(best, under)
  }
  return best
}

describe('escalera en U de la casa de 3 pisos', () => {
  it('sube caminando del piso 1 al 2 y del 2 al 3 sin trabarse ni meter la cabeza en la losa', () => {
    const up1 = stairRoute(model, p1!.id, 1)!
    const start = spawnAt(world, up1[0]!, p1!.id)
    expect(start.y).toBeCloseTo(0)
    const a = follow(world, start, up1)
    expect(a.st.levelId).toBe(p2!.id)
    expect(a.st.y).toBeCloseTo(2.6, 1)
    expect(a.headroom).toBeGreaterThan(0)
    const up2 = stairRoute(model, p2!.id, 1)!
    const b = follow(world, a.st, up2)
    expect(b.st.levelId).toBe(p3!.id)
    expect(b.st.y).toBeCloseTo(5.2, 1)
    expect(b.headroom).toBeGreaterThan(0)
  })

  it('baja del piso 3 al 1 por la misma escalera', () => {
    const top = spawnAt(world, stairRoute(model, p3!.id, -1)![0]!, p3!.id)
    const a = follow(world, top, stairRoute(model, p3!.id, -1)!)
    expect(a.st.levelId).toBe(p2!.id)
    const b = follow(world, a.st, stairRoute(model, p2!.id, -1)!)
    expect(b.st.levelId).toBe(p1!.id)
    expect(b.st.y).toBeCloseTo(0, 1)
  })

  it('el salto de piso aparece arriba de la escalera, no en un descanso', () => {
    const at = levelArrival(model, p1!.id, 1)!
    const s = spawnAt(world, at.point, at.levelId)
    expect(s.levelId).toBe(p2!.id)
    expect(s.y).toBeCloseTo(2.6, 1)
    const down = levelArrival(model, p2!.id, -1)!
    expect(spawnAt(world, down.point, down.levelId).y).toBeCloseTo(0, 1)
  })
})

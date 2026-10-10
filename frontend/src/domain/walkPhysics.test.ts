import { describe, expect, it } from 'vitest'
import type { BuildingModel, Level } from '@/api/types'
import { door, rect, wall } from '@/test/fixtures'
import { buildWalkWorld, EYE_HEIGHT, groundAt, nearestDoor, spawnAt, stepCharacter, type CharacterState, type WalkWorld } from './walkPhysics'

/**
 * Casa de dos pisos, 8×4 m:
 * - planta baja: dos ambientes separados por un muro en x=4 con una puerta (y de 1,5 a 2,4);
 *   escalera recta de 15 peldaños de 0,18 m (sube 2,7 m) de (5,3.5) a (8,3.5)... dentro del
 *   ambiente derecho, subiendo hacia +x;
 * - planta alta a 2,7 m con un muro en x=2 que NO debe estorbar abajo.
 */
function house(): BuildingModel {
  const ground: Level = {
    id: 'pb',
    name: 'Planta baja',
    elevation: 0,
    walls: [
      wall('n', 0, 0, 8, 0),
      wall('e', 8, 0, 8, 4),
      wall('s', 8, 4, 0, 4),
      wall('o', 0, 4, 0, 0),
      wall('mid', 4, 0, 4, 4, [door('d1', 1.5)]),
    ],
    rooms: [rect('r1', 'Sala', 0.1, 0.1, 3.9, 3.9), rect('r2', 'Cocina', 4.1, 0.1, 7.9, 3.9)],
    stairs: [{ id: 'st', start: { x: 4.5, y: 3.3 }, end: { x: 7.5, y: 3.3 }, width: 1, steps: 15, riser: 0.18, base: 0, confidence: 1 }],
    columns: [{ id: 'c1', center: { x: 2, y: 1 }, width: 0.3, depth: 0.3, rotation: 0, round: false, confidence: 1 }],
  }
  const upper: Level = {
    id: 'pa',
    name: 'Planta alta',
    elevation: 2.7,
    walls: [wall('n2', 0, 0, 8, 0), wall('e2', 8, 0, 8, 4), wall('s2', 8, 4, 0, 4), wall('o2', 0, 4, 0, 0), wall('x2', 2, 0, 2, 4)],
    rooms: [],
  }
  return { project_id: 'p', scale: { meters_per_pixel: 0.01, source: 'vector', confidence: 1 }, levels: [ground, upper] }
}

/** Camina hacia un punto durante `seconds` a 2,2 m/s (60 cuadros por segundo). */
function walk(world: WalkWorld, s: CharacterState, to: { x: number; z: number }, seconds: number, isOpen?: (id: string) => boolean): CharacterState {
  let st = s
  for (let i = 0; i < seconds * 60; i++) {
    const dx = to.x - st.x
    const dz = to.z - st.z
    const d = Math.hypot(dx, dz)
    if (d < 0.02) break
    const step = Math.min(d, 2.2 / 60)
    st = stepCharacter(st, { dx: (dx / d) * step, dz: (dz / d) * step }, 1 / 60, world, isOpen)
  }
  return st
}

const idle = (world: WalkWorld, s: CharacterState, seconds: number) => {
  let st = s
  for (let i = 0; i < seconds * 60; i++) st = stepCharacter(st, { dx: 0, dz: 0 }, 1 / 60, world)
  return st
}

describe('física del recorrido', () => {
  const world = buildWalkWorld(house())

  it('sobre el piso se queda a ras (los ojos a 1,6 m) y en la planta baja', () => {
    const s = idle(world, spawnAt(world, { x: 1, y: 2 }), 1)
    expect(s.y).toBeCloseTo(0)
    expect(s.levelId).toBe('pb')
    expect(s.y + EYE_HEIGHT).toBeCloseTo(1.6)
  })

  it('una puerta cerrada bloquea y abierta deja pasar', () => {
    const start = spawnAt(world, { x: 3, y: 1.95 })
    const closed = walk(world, start, { x: 5, z: 1.95 }, 2, () => false)
    expect(closed.x).toBeLessThan(4)
    const open = walk(world, start, { x: 5, z: 1.95 }, 2, (id) => id === 'd1')
    expect(open.x).toBeCloseTo(5, 1)
  })

  it('los muros de la planta alta no estorban en la planta baja', () => {
    // x2 (x = 2) solo existe arriba: abajo se cruza sin problema
    const s = walk(world, spawnAt(world, { x: 1, y: 3 }), { x: 3, z: 3 }, 2)
    expect(s.x).toBeCloseTo(3, 1)
  })

  it('las columnas bloquean', () => {
    const s = walk(world, spawnAt(world, { x: 1, y: 1 }), { x: 3, z: 1 }, 2)
    expect(s.x).toBeLessThan(2 - 0.15 - 0.2)
  })

  it('sube la escalera caminando y llega a la planta alta; al bajar vuelve abajo', () => {
    const bottom = spawnAt(world, { x: 4.3, y: 3.3 })
    const top = walk(world, bottom, { x: 7.9, z: 3.3 }, 6)
    expect(top.y).toBeCloseTo(2.7, 1)
    expect(top.levelId).toBe('pa')
    const back = walk(world, idle(world, top, 0.3), { x: 4.3, z: 3.3 }, 6)
    expect(back.y).toBeCloseTo(0, 1)
    expect(back.levelId).toBe('pb')
  })

  it('un peldaño demasiado alto frena como una pared', () => {
    // de lado, junto a los peldaños altos de la escalera, no se puede "trepar"
    const s = walk(world, spawnAt(world, { x: 6.8, y: 2.2 }), { x: 6.8, z: 3.3 }, 2)
    expect(s.y).toBeCloseTo(0)
    expect(s.z).toBeLessThan(3.3 - 0.5)
  })

  it('cae con gravedad si queda en el aire', () => {
    const air: CharacterState = { x: 1, z: 2, y: 1.5, vy: 0, levelId: 'pb' }
    const s1 = stepCharacter(air, { dx: 0, dz: 0 }, 0.1, world)
    expect(s1.y).toBeLessThan(1.5)
    expect(s1.vy).toBeLessThan(0)
    expect(idle(world, s1, 1).y).toBeCloseTo(0)
  })

  it('el piso alto no se pisa desde abajo, pero sí al estar arriba', () => {
    expect(groundAt(world, 1, 2, 0)).toBe(0)
    expect(groundAt(world, 1, 2, 2.7)).toBe(2.7)
    // sobre el hueco de la escalera, arriba se pisa el peldaño, no el piso alto
    expect(groundAt(world, 7.4, 3.3, 2.7)).toBeCloseTo(2.7, 5)
    expect(groundAt(world, 6.0, 3.3, 2.7)).toBeLessThan(2.7)
  })

  it('aparecer en un ambiente de la planta alta deja los pies en su piso', () => {
    expect(spawnAt(world, { x: 1, y: 2 }, 'pa')).toMatchObject({ y: 2.7, levelId: 'pa' })
  })

  it('nearestDoor encuentra la puerta del nivel al acercarse', () => {
    expect(nearestDoor(world, 'pb', { x: 3.4, y: 1.9 }, 1.2)?.openingId).toBe('d1')
    expect(nearestDoor(world, 'pb', { x: 1, y: 1 }, 1.2)).toBeNull()
    expect(nearestDoor(world, 'pa', { x: 3.4, y: 1.9 }, 1.2)).toBeNull()
  })

  it('propiedad: con cualquier paso de tiempo nunca atraviesa un muro', () => {
    for (const dt of [1 / 120, 1 / 60, 1 / 30, 0.1, 0.5]) {
      let s = spawnAt(world, { x: 1, y: 2 })
      for (let i = 0; i < 200; i++) s = stepCharacter(s, { dx: -0.4, dz: 0.05 }, dt, world)
      expect(s.x).toBeGreaterThan(0)
    }
  })
})

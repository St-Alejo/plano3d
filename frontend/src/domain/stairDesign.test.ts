import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { BuildingModel } from '@/api/types'
import { buildScene, disposeScene } from '@/features/viewer3d/scene/SceneBuilder'
import opc3 from '@/test/opc3.json'
import { stairWell } from './geometry'
import { clipWellToRoom, flightProfile, stairRailing, wellGuards, withRealStairs } from './stairDesign'
import { buildWalkWorld, spawnAt, stepCharacter } from './walkPhysics'

const model = opc3 as unknown as BuildingModel
const [p1, p2, p3] = [...model.levels].sort((a, b) => a.elevation - b.elevation)

describe('la escalera como se construye', () => {
  it('el último piso no tiene la escalera copiada que sube hacia la nada', () => {
    expect(p3!.stairs).toHaveLength(3)
    const real = withRealStairs(model)
    expect(real.levels.find((l) => l.id === p3!.id)!.stairs).toHaveLength(0)
    expect(real.levels.find((l) => l.id === p2!.id)!.stairs).toHaveLength(3)
    // con un solo piso no se quita nada (puede ser la escalera a la azotea)
    const one = { ...model, levels: [p3!] }
    expect(withRealStairs(one)).toBe(one)
  })

  it('cada tramo es un perfil de peldaños sobre una losa inclinada, sin bajar al piso', () => {
    const s = p1!.stairs![0]!
    const prof = flightProfile(s)
    const top = Math.max(...prof.map((p) => p.y))
    expect(top).toBeCloseTo(s.riser * s.steps)
    // 5 peldaños: 10 vértices de diente de sierra más el arranque y la losa de abajo
    expect(prof.length).toBeGreaterThanOrEqual(12)
    // la cara inferior es inclinada: en la mitad del tramo la losa está bien por encima del piso
    const len = Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y)
    const under = prof.filter((p) => p.x > len * 0.4 && p.x < len)
    expect(Math.min(...under.map((p) => p.y))).toBeGreaterThan(0.2)
  })

  it('la baranda va por el ojo (adentro de la C) y sigue por los descansos', () => {
    const { posts, rails } = stairRailing(p1!.stairs!, p1!.walls)
    expect(posts).toHaveLength(15) // un balaustre por peldaño
    expect(rails).toHaveLength(5) // 3 pasamanos inclinados + 2 en los descansos
    const well = stairWell(p1!.stairs!)!
    const cx = (well.minX + well.maxX) / 2
    const cy = (well.minY + well.maxY) / 2
    // cada pasamanos queda más cerca del centro de la escalera que el eje de su tramo
    for (const s of p1!.stairs!) {
      const mid = { x: (s.start.x + s.end.x) / 2, y: (s.start.y + s.end.y) / 2 }
      const rail = rails.find((r) => Math.hypot((r.a[0] + r.b[0]) / 2 - mid.x, (r.a[2] + r.b[2]) / 2 - mid.y) < s.width)!
      expect(Math.hypot((rail.a[0] + rail.b[0]) / 2 - cx, (rail.a[2] + rail.b[2]) / 2 - cy)).toBeLessThan(Math.hypot(mid.x - cx, mid.y - cy))
      expect(rail.b[1]).toBeGreaterThan(rail.a[1]) // sube con el tramo
    }
  })

  it('el hueco de arriba lleva baranda donde no hay muro, con paso donde llega y arranca la escalera', () => {
    const g3 = wellGuards(model, p3!)
    expect(g3.length).toBeGreaterThan(0)
    const len = g3.reduce((s, g) => s + Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y), 0)
    expect(len).toBeGreaterThan(1)
    // la llegada del último tramo queda libre
    const arrive = p2!.stairs!.at(-1)!.end
    for (const g of g3) {
      const d = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y)
      const k = Math.max(0, Math.min(1, ((arrive.x - g.a.x) * (g.b.x - g.a.x) + (arrive.y - g.a.y) * (g.b.y - g.a.y)) / (d * d)))
      expect(Math.hypot(arrive.x - (g.a.x + (g.b.x - g.a.x) * k), arrive.y - (g.a.y + (g.b.y - g.a.y) * k))).toBeGreaterThan(0.3)
    }
  })

  it('el piso del ambiente de arriba tiene el hueco recortado (no hay baldosa sobre el vacío)', () => {
    const well = stairWell(p1!.stairs!)!
    const room = p2!.rooms.find((r) => /escalera/i.test(r.label))!
    const hole = clipWellToRoom(room.polygon, well)!
    expect(hole.length).toBeGreaterThanOrEqual(4)
    const s = buildScene(model)
    const floor = s.root.getObjectByName(`room:${room.id}`) as THREE.Mesh
    expect((floor.geometry as THREE.ExtrudeGeometry).parameters.shapes).toMatchObject({ holes: [expect.anything()] })
    expect(s.root.getObjectByName(`stair:${p3!.stairs![0]!.id}`)).toBeUndefined()
    disposeScene(s)
  })

  it('en el recorrido la baranda del hueco no deja caer al vacío', () => {
    const world = buildWalkWorld(model)
    const guard = wellGuards(model, p3!)[0]!
    const mid = { x: (guard.a.x + guard.b.x) / 2, y: (guard.a.y + guard.b.y) / 2 }
    const d = { x: guard.b.x - guard.a.x, y: guard.b.y - guard.a.y }
    const n = Math.hypot(d.x, d.y)
    const out = { x: -d.y / n, y: d.x / n }
    // del lado del piso (fuera del hueco) caminar contra la baranda
    const well = stairWell(p2!.stairs!)!
    const inside = (p: { x: number; y: number }) => p.x > well.minX && p.x < well.maxX && p.y > well.minY && p.y < well.maxY
    const side = inside({ x: mid.x + out.x * 0.5, y: mid.y + out.y * 0.5 }) ? -1 : 1
    let st = { ...spawnAt(world, { x: mid.x + out.x * side * 0.5, y: mid.y + out.y * side * 0.5 }), y: p3!.elevation, levelId: p3!.id }
    for (let i = 0; i < 60; i++) st = stepCharacter(st, { dx: -out.x * side * 0.05, dz: -out.y * side * 0.05 }, 1 / 30, world)
    expect(st.y).toBeGreaterThan(p3!.elevation - 0.05)
    expect(inside({ x: st.x, y: st.z })).toBe(false)
  })
})

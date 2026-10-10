import * as THREE from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import type { BuildingModel } from '@/api/types'
import { buildWalkWorld, spawnAt, stepCharacter } from '@/domain/walkPhysics'
import { door, sampleModel, wall, windowOp } from '@/test/fixtures'
import { doorPassable, doorProgress, DOOR_SECONDS, kindOf, resetDoorProgress, stepDoors } from './doors'
import { buildScene } from './scene/SceneBuilder'

const leafTip = (root: THREE.Object3D, id: string) => {
  root.updateMatrixWorld(true)
  const mesh = (root.getObjectByName(`door:${id}`)!.children[0] as THREE.Group).children[0] as THREE.Mesh<THREE.BoxGeometry>
  // extremo libre de la hoja (lejos de la bisagra)
  return new THREE.Vector3(mesh.geometry.parameters.width / 2, 0, 0).applyMatrix4(mesh.matrixWorld)
}

beforeEach(() => resetDoorProgress())

describe('puertas animables', () => {
  it('la hoja cuelga de un pivote en la bisagra y cerrada queda en el vano', () => {
    const s = buildScene(sampleModel())
    const pivot = s.root.getObjectByName('door:o_door')!.children[0]!
    // muro w_mid de (6,0) a (6,7); puerta en offset 3 → bisagra en (6, 3)
    expect(pivot.position.x).toBeCloseTo(6)
    expect(pivot.position.z).toBeCloseTo(3)
    const tip = leafTip(s.root, 'o_door')
    expect(tip.x).toBeCloseTo(6)
    expect(tip.z).toBeCloseTo(3.9)
  })

  it('abrir gira la hoja 90° sobre la bisagra en el tiempo de la animación', () => {
    const s = buildScene(sampleModel())
    stepDoors(s.root, { o_door: true }, DOOR_SECONDS / 2)
    expect(doorProgress('o_door')).toBeCloseTo(0.5)
    stepDoors(s.root, { o_door: true }, DOOR_SECONDS)
    expect(doorProgress('o_door')).toBe(1)
    expect(doorPassable('o_door')).toBe(true)
    const tip = leafTip(s.root, 'o_door')
    // abierta: la hoja queda perpendicular al muro, a 0,9 m de la bisagra
    expect(Math.abs(tip.x - 6)).toBeCloseTo(0.9)
    expect(tip.z).toBeCloseTo(3)
    stepDoors(s.root, { o_door: false }, DOOR_SECONDS * 2)
    expect(doorProgress('o_door')).toBe(0)
  })

  it('doble batiente: dos hojas de medio vano; corrediza: se desliza', () => {
    const m: BuildingModel = sampleModel()
    const lv = m.levels[0]!
    lv.walls[0] = wall('w_top', 0, 0, 10, 0, [{ ...door('dd', 1, 1.6), operation: 'double_swing' }, { ...door('sl', 5, 1.2), operation: 'sliding' }])
    const s = buildScene(m)
    expect(s.root.getObjectByName('door:dd')!.children).toHaveLength(2)
    const slide = s.root.getObjectByName('door:sl')!.children[0]!
    const x0 = slide.position.x
    stepDoors(s.root, { sl: true }, 1)
    expect(slide.position.x).toBeGreaterThan(x0 + 0.4)
  })

  it('el vidrio de la ventana y la puerta se reconocen al tocarlos', () => {
    const s = buildScene(sampleModel())
    expect(kindOf(s.root.getObjectByName('glass:o_win')!)).toMatchObject({ kind: 'window', data: { openingId: 'o_win' } })
    const leaf = (s.root.getObjectByName('door:o_door')!.children[0] as THREE.Group).children[0]!
    expect(kindOf(leaf)?.data.openingId).toBe('o_door')
  })

  it('una puerta cerrada frena al recorrer; abierta (animada) deja pasar', () => {
    const m = sampleModel()
    const world = buildWalkWorld(m)
    const s = buildScene(m)
    let st = spawnAt(world, { x: 5, y: 3.45 })
    for (let i = 0; i < 60; i++) st = stepCharacter(st, { dx: 0.05, dz: 0 }, 1 / 60, world, doorPassable)
    expect(st.x).toBeLessThan(6)
    stepDoors(s.root, { o_door: true }, 1)
    for (let i = 0; i < 60; i++) st = stepCharacter(st, { dx: 0.05, dz: 0 }, 1 / 60, world, doorPassable)
    expect(st.x).toBeGreaterThan(6.5)
  })
})

describe('losas y descansos', () => {
  it('el piso alto tiene losa con el hueco de la escalera; la U lleva descanso', () => {
    const m: BuildingModel = {
      project_id: 'p',
      scale: { meters_per_pixel: 0.01, source: 'vector', confidence: 1 },
      levels: [
        {
          id: 'a',
          name: 'PB',
          elevation: 0,
          walls: [wall('n', 0, 0, 6, 0, [windowOp('w', 1)])],
          rooms: [],
          stairs: [
            { id: 's1', start: { x: 1, y: 1 }, end: { x: 3, y: 1 }, width: 1, steps: 8, riser: 0.17, base: 0, confidence: 1 },
            { id: 's2', start: { x: 3, y: 2.2 }, end: { x: 1, y: 2.2 }, width: 1, steps: 8, riser: 0.17, base: 1.36, confidence: 1 },
          ],
        },
        { id: 'b', name: 'PA', elevation: 2.72, walls: [wall('n2', 0, 0, 6, 0), wall('s2', 6, 4, 0, 4)], rooms: [] },
      ],
    }
    const s = buildScene(m)
    const slab = s.root.getObjectByName('slab:b') as THREE.Mesh
    expect(slab).toBeTruthy()
    expect((slab.geometry as THREE.ExtrudeGeometry).parameters.shapes).toBeTruthy()
    expect(s.root.getObjectByName('landing:a:0')).toBeTruthy()
    // la física sube toda la U y llega a la planta alta
    const world = buildWalkWorld(m)
    let st = spawnAt(world, { x: 0.4, y: 1 })
    const go = (tx: number, tz: number) => {
      for (let i = 0; i < 400; i++) {
        const dx = tx - st.x
        const dz = tz - st.z
        const d = Math.hypot(dx, dz)
        if (d < 0.03) break
        const k = Math.min(d, 0.035) / d
        st = stepCharacter(st, { dx: dx * k, dz: dz * k }, 1 / 60, world)
      }
    }
    go(3.4, 1)
    go(3.4, 2.2)
    go(0.5, 2.2)
    expect(st.y).toBeCloseTo(2.72, 1)
    expect(st.levelId).toBe('b')
  })
})

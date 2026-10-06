import { describe, expect, it } from 'vitest'
import type { BuildingModel } from '@/api/types'
import { door, rect, sampleModel, wall } from '@/test/fixtures'
import { CommandError, MoveJoint, SetWallAngle, SetWallLength, TranslateWall } from './commands'
import { findLevel, findWall, polygonArea, wallLength } from './model'
import { enclosedSpaces, polygonIoU, recomputeRooms, roomsDiffer } from './rooms'
import { applyJointMoves, endpointsAt, tJunctionsOn } from './topology'

const L = 'lvl_0'
const lv = (m: BuildingModel = sampleModel()) => findLevel(m, L)
const w = (m: BuildingModel, id: string) => findWall(lv(m), id)

describe('topología', () => {
  it('encuentra los extremos que forman una esquina', () => {
    expect(endpointsAt(lv().walls, { x: 10, y: 0 })).toEqual([
      { wallId: 'w_top', end: 'end' },
      { wallId: 'w_right', end: 'start' },
    ])
  })

  it('encuentra muros apoyados en T sobre otro', () => {
    const t = tJunctionsOn(lv().walls, findWall(lv(), 'w_top'))
    expect(t).toEqual([{ wallId: 'w_mid', end: 'start', t: 0.6 }])
  })

  it('mover una esquina arrastra a los dos muros y deja la T apoyada', () => {
    const changed = applyJointMoves(lv(), [{ from: { x: 10, y: 0 }, to: { x: 12, y: 0 } }])
    expect(changed.get('w_top')!.end).toEqual({ x: 12, y: 0 })
    expect(changed.get('w_right')!.start).toEqual({ x: 12, y: 0 })
    // estirar la fachada no desplaza el muro interior que nace de ella (no cambia)
    expect(changed.has('w_mid')).toBe(false)
  })

  it('al trasladar el anfitrión entero, la T se traslada con él', () => {
    const changed = applyJointMoves(lv(), [
      { from: { x: 0, y: 0 }, to: { x: 0, y: -1 } },
      { from: { x: 10, y: 0 }, to: { x: 10, y: -1 } },
    ])
    expect(changed.get('w_mid')!.start).toEqual({ x: 6, y: -1 })
  })

  it('al girar el anfitrión, la T conserva su posición relativa', () => {
    const changed = applyJointMoves(lv(), [
      { from: { x: 0, y: 0 }, to: { x: 0, y: 1 } },
      { from: { x: 10, y: 0 }, to: { x: 10, y: -1 } },
    ])
    const p = changed.get('w_mid')!.start
    expect(p.x).toBeCloseTo(6)
    expect(p.y).toBeCloseTo(-0.2)
  })
})

describe('comandos que respetan las uniones', () => {
  it('MoveJoint: la esquina se mueve para todos y se deshace exacto', () => {
    const cmd = new MoveJoint(L, { x: 10, y: 7 }, { x: 11, y: 8 })
    const m = cmd.execute(sampleModel())
    expect(w(m, 'w_right').end).toEqual({ x: 11, y: 8 })
    expect(w(m, 'w_bottom').start).toEqual({ x: 11, y: 8 })
    expect(cmd.undo(m)).toEqual(sampleModel())
  })

  it('TranslateWall estira a los vecinos: la planta sigue cerrada', () => {
    const m = new TranslateWall(L, 'w_right', 1, 0).execute(sampleModel())
    expect(w(m, 'w_right').start).toEqual({ x: 11, y: 0 })
    expect(w(m, 'w_top').end).toEqual({ x: 11, y: 0 })
    expect(w(m, 'w_bottom').start).toEqual({ x: 11, y: 7 })
    expect(enclosedSpaces(lv(m).walls)).toHaveLength(2)
  })

  it('TranslateWall a lo largo del muro conserva las aberturas relativas', () => {
    const m = new TranslateWall(L, 'w_mid', 0, 0.5).execute(sampleModel())
    expect(w(m, 'w_mid').openings[0]!.offset).toBe(3)
  })

  it('SetWallLength fija el largo y arrastra la esquina final', () => {
    const m = new SetWallLength(L, 'w_top', 11).execute(sampleModel())
    expect(wallLength(w(m, 'w_top'))).toBeCloseTo(11)
    expect(w(m, 'w_right').start).toEqual({ x: 11, y: 0 })
    expect(() => new SetWallLength(L, 'w_top', 0)).toThrow(CommandError)
  })

  it('SetWallAngle gira alrededor del inicio', () => {
    const m = new SetWallAngle(L, 'w_top', 90).execute(sampleModel())
    const top = w(m, 'w_top')
    expect(top.end.x).toBeCloseTo(0)
    expect(top.end.y).toBeCloseTo(10)
    expect(() => new SetWallAngle(L, 'w_top', Number.NaN)).toThrow(CommandError)
  })

  it('rechaza un movimiento que deja una abertura fuera del muro, sin cambiar nada', () => {
    const cmd = new MoveJoint(L, { x: 6, y: 7 }, { x: 6, y: 3.2 })
    expect(() => cmd.execute(sampleModel())).toThrow(CommandError)
  })

  it('si no hay nada en ese punto, avisa', () => {
    expect(() => new MoveJoint(L, { x: 55, y: 55 }, { x: 1, y: 1 }).execute(sampleModel())).toThrow(CommandError)
  })
})

describe('ambientes derivados de los muros', () => {
  it('encuentra los espacios cerrados con sus áreas interiores', () => {
    const spaces = enclosedSpaces(lv().walls)
    expect(spaces).toHaveLength(2)
    const areas = spaces.map(polygonArea).sort((a, b) => a - b)
    // grosor 0,20: (4 − 0,2) × (7 − 0,2) y (6 − 0,2) × (7 − 0,2)
    expect(areas[0]).toBeCloseTo(3.8 * 6.8, 6)
    expect(areas[1]).toBeCloseTo(5.8 * 6.8, 6)
  })

  it('las puertas no abren el ambiente (los muros se unen enteros)', () => {
    expect(enclosedSpaces(lv().walls)).toHaveLength(2)
  })

  it('conserva nombre, id y confianza de los ambientes que siguen existiendo', () => {
    const rooms = recomputeRooms(lv())
    expect(rooms.map((r) => [r.id, r.label])).toEqual([
      ['r_a', 'Sala'],
      ['r_b', 'Espacio 2'],
    ])
  })

  it('al agregar un muro divisorio aparece un ambiente nuevo con nombre libre', () => {
    const m = sampleModel()
    const level = lv(m)
    const withWall = { ...level, walls: [...level.walls, wall('w_new', 0, 3, 6, 3)] }
    const rooms = recomputeRooms(withWall)
    expect(rooms).toHaveLength(3)
    expect(rooms.map((r) => r.label)).toContain('Sala')
    expect(rooms.find((r) => r.id !== 'r_a' && r.id !== 'r_b')!.label).toBe('Espacio 1')
  })

  it('al borrar el muro divisorio los dos ambientes se funden en uno', () => {
    const level = lv()
    const rooms = recomputeRooms({ ...level, walls: level.walls.filter((x) => x.id !== 'w_mid') })
    expect(rooms).toHaveLength(1)
    expect(polygonArea(rooms[0]!.polygon)).toBeCloseTo(9.8 * 6.8, 6)
  })

  it('una planta abierta (sin cerrar) no inventa ambientes', () => {
    expect(enclosedSpaces([wall('a', 0, 0, 5, 0), wall('b', 5, 0, 5, 5, [door('d', 1)])])).toEqual([])
    expect(enclosedSpaces([])).toEqual([])
  })

  it('IoU y detección de cambios', () => {
    const a = rect('a', 'x', 0, 0, 2, 2).polygon
    expect(polygonIoU(a, a)).toBeCloseTo(1)
    expect(polygonIoU(a, rect('b', 'x', 1, 0, 3, 2).polygon)).toBeCloseTo(1 / 3)
    expect(polygonIoU(a, rect('c', 'x', 5, 5, 6, 6).polygon)).toBe(0)
    const rooms = recomputeRooms(lv())
    expect(roomsDiffer(rooms, rooms)).toBe(false)
    expect(roomsDiffer(rooms, rooms.slice(1))).toBe(true)
  })
})

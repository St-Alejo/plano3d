import { beforeEach, describe, expect, it } from 'vitest'
import type { BuildingModel } from '@/api/types'
import { selectLevel, useEditor } from '@/store/editorStore'
import { CommandError } from './commands'
import { DrawRoom, missingSpans, rectangleWalls, rectFrom } from './drawing'
import { wallLength } from './model'

const blank = (): BuildingModel => ({
  project_id: 'prj_b',
  scale: { meters_per_pixel: 0.01, source: 'vector', confidence: 1 },
  levels: [{ id: 'lvl_0', name: 'Planta 1', elevation: 0, walls: [], rooms: [] }],
})

const level = () => selectLevel(useEditor.getState())!
const draw = (x: number, y: number, w: number, h: number, name: string) =>
  useEditor.getState().dispatch(new DrawRoom('lvl_0', level(), { x, y, w, h }, name))

beforeEach(() => {
  useEditor.getState().reset()
  useEditor.getState().load('prj_b', blank())
})

describe('ambiente rectangular', () => {
  it('rectFrom normaliza las esquinas', () => {
    expect(rectFrom({ x: 4, y: 5 }, { x: 0, y: 1 })).toEqual({ x: 0, y: 1, w: 4, h: 4 })
  })

  it('en un plano vacío crea 4 muros y un ambiente con el nombre pedido', () => {
    expect(draw(0, 0, 4, 5, 'Sala')).toBe(true)
    expect(level().walls).toHaveLength(4)
    expect(level().rooms.map((r) => r.label)).toEqual(['Sala'])
    expect(useEditor.getState().undoLabel).toBe('Dibujar sala')
  })

  it('un vecino comparte el muro: no se duplica y quedan dos ambientes con nombre', () => {
    draw(0, 0, 4, 5, 'Sala')
    draw(4, 0, 3, 3, 'Cocina')
    // la cocina solo agrega 3 muros: norte, este y sur (el oeste ya es el muro de la sala)
    expect(level().walls).toHaveLength(7)
    expect(level().rooms.map((r) => r.label).sort()).toEqual(['Cocina', 'Sala'])
  })

  it('si el vecino cubre solo una parte del lado, se crea el tramo que falta', () => {
    draw(0, 0, 4, 3, 'Alcoba')
    const missing = missingSpans(level().walls, { x: 4, y: 0 }, { x: 4, y: 5 })
    expect(missing).toHaveLength(1)
    expect(missing[0]![0].y).toBeCloseTo(3)
    expect(missing[0]![1].y).toBeCloseTo(5)
  })

  it('deshacer quita muros y ambiente', () => {
    draw(0, 0, 4, 5, 'Sala')
    useEditor.getState().undo()
    expect(level().walls).toHaveLength(0)
    expect(level().rooms).toHaveLength(0)
  })

  it('rechaza ambientes diminutos o ya cerrados', () => {
    expect(() => new DrawRoom('lvl_0', level(), { x: 0, y: 0, w: 0.2, h: 3 }, 'x')).toThrow(CommandError)
    draw(0, 0, 4, 5, 'Sala')
    expect(rectangleWalls(level(), { x: 0, y: 0, w: 4, h: 5 })).toHaveLength(0)
    expect(() => new DrawRoom('lvl_0', level(), { x: 0, y: 0, w: 4, h: 5 }, 'Otra')).toThrow(CommandError)
  })

  it('los muros nuevos miden lo que falta', () => {
    draw(0, 0, 4, 5, 'Sala')
    expect(level().walls.map(wallLength).sort()).toEqual([4, 4, 5, 5])
  })
})

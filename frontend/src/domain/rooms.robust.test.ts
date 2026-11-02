import { describe, expect, it } from 'vitest'
import polygonClipping from 'polygon-clipping'
import type { Level, Wall } from '@/api/types'
import walls from './__fixtures__/walls-photo.json'
import { enclosedSpaces, recomputeRooms } from './rooms'

// muros detectados en una foto real: con coordenadas sin ajustar, polygon-clipping
// lanzaba "Unable to complete output ring" y ninguna edición del plano se podía aplicar
const photoWalls = walls as unknown as Wall[]

describe('ambientes con geometría casi degenerada', () => {
  it('los muros de la foto encierran sus ambientes sin lanzar', () => {
    expect(enclosedSpaces(photoWalls).length).toBeGreaterThanOrEqual(6)
  })

  it('si la unión falla en todas las rejillas, se conservan los ambientes anteriores', () => {
    const level = { id: 'l', name: 'P1', elevation: 0, height: 2.6, walls: photoWalls, rooms: [{ id: 'r1', label: 'Sala', polygon: [], confidence: 1 }] } as unknown as Level
    const union = polygonClipping.union
    polygonClipping.union = () => {
      throw new Error('Unable to complete output ring')
    }
    try {
      expect(recomputeRooms(level)).toBe(level.rooms)
    } finally {
      polygonClipping.union = union
    }
  })
})

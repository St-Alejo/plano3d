import { describe, expect, it } from 'vitest'
import type { BuildingModel } from '@/api/types'
import { modelBounds } from '@/domain/model'
import opc3 from '@/test/opc3.json'
import { sampleModel } from '@/test/fixtures'
import { buildingHeight } from '../scene/viewTools'
import { PHOTO_VIEWS, photoShots, showcaseRoom, streetShot } from './shots'

const model = opc3 as unknown as BuildingModel

describe('tomas de las fotos con IA', () => {
  it('cinco vistas en el orden de la galería; la de noche reutiliza la toma de la calle', () => {
    const shots = photoShots(model)
    expect(shots.map((s) => s.view)).toEqual(PHOTO_VIEWS.map((v) => v.view))
    const street = shots.find((s) => s.view === 'calle')!.shot
    expect(shots.find((s) => s.view === 'noche')!.shot).toBe(street)
  })

  it('la calle mira la fachada de frente, a la altura de los ojos y con toda la casa en cuadro', () => {
    const b = modelBounds(model)
    const h = buildingHeight(model)
    const s = streetShot(b, h)
    expect(s.pos[1]).toBe(1.6)
    expect(s.pos[0]).toBeCloseTo(b.center.x)
    expect(s.pos[2]).toBeGreaterThan(b.maxY)
    // el alto de la casa cabe en el campo vertical desde esa distancia
    const d = s.pos[2] - b.maxY
    const half = Math.tan(((s.fov / 2) * Math.PI) / 180) * d
    expect(h - s.look[1]).toBeLessThan(half)
  })

  it('por dentro: elige la sala-comedor, no el parqueadero ni un baño, y la cámara queda adentro', () => {
    const pick = showcaseRoom(model)!
    expect(pick.room.label).toMatch(/sala|comedor|cocina/i)
    const inside = photoShots(model).find((s) => s.view === 'interior')!.shot
    const xs = pick.room.polygon.map((p) => p.x)
    const ys = pick.room.polygon.map((p) => p.y)
    expect(inside.pos[0]).toBeGreaterThan(Math.min(...xs))
    expect(inside.pos[0]).toBeLessThan(Math.max(...xs))
    expect(inside.pos[2]).toBeGreaterThan(Math.min(...ys))
    expect(inside.pos[2]).toBeLessThan(Math.max(...ys))
    expect(inside.pos[1]).toBeCloseTo(pick.elevation + 1.45)
  })

  it('sin ambientes habitables no hay toma de interior (quedan cuatro fotos)', () => {
    const m = sampleModel()
    const bare = { ...m, levels: m.levels.map((lv) => ({ ...lv, rooms: [] })) }
    expect(photoShots(bare).map((s) => s.view)).toEqual(['calle', 'esquina', 'costado', 'noche'])
  })
})

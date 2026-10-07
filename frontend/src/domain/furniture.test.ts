import { describe, expect, it } from 'vitest'
import type { Furniture } from '@/api/types'
import { wall } from '@/test/fixtures'
import { CATALOG, catalogItem, scaledParts } from './catalog'
import { footprint, toPlan, wallsHitBy } from './furniture'

const f = (x: number, y: number, rotation = 0, width = 2, depth = 1): Furniture => ({
  id: 'f',
  catalog_id: 'sofa_3',
  position: { x, y },
  width,
  depth,
  height: 0.8,
  rotation,
})

describe('catálogo', () => {
  it('ids únicos y válidos para el backend, partes dentro de la huella', () => {
    const ids = CATALOG.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => /^[a-z0-9][a-z0-9_-]{0,47}$/.test(id))).toBe(true)
    expect(CATALOG.length).toBeGreaterThanOrEqual(20)
    for (const c of CATALOG)
      for (const p of c.parts) {
        expect(Math.abs(p.x) + p.w / 2, `${c.id} ancho`).toBeLessThanOrEqual(c.width / 2 + 0.011)
        expect(Math.abs(p.z) + p.d / 2, `${c.id} fondo`).toBeLessThanOrEqual(c.depth / 2 + 0.011)
        expect(p.y0 + p.h, `${c.id} alto`).toBeLessThanOrEqual(c.height + 1e-9)
      }
  })

  it('redimensionar escala las partes en proporción', () => {
    const bed = catalogItem('cama_doble')!
    const parts = scaledParts(bed, bed.width * 2, bed.depth, bed.height)
    expect(parts[0]!.w).toBeCloseTo(bed.parts[0]!.w * 2)
    expect(parts[0]!.d).toBeCloseTo(bed.parts[0]!.d)
  })
})

describe('huella y choque', () => {
  it('gira las coordenadas locales hacia la planta', () => {
    const p = toPlan(f(1, 1, Math.PI / 2), 1, 0)
    expect(p.x).toBeCloseTo(1)
    expect(p.y).toBeCloseTo(2)
    const corners = footprint(f(0, 0, Math.PI / 2))
    const xs = corners.map((c) => c.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1)
  })

  it('detecta el muro que la huella atraviesa y tolera apoyarse contra él', () => {
    const walls = [wall('w', 0, 0, 10, 0)] // grosor 0,2: ocupa y ∈ [-0,1; 0,1]
    expect(wallsHitBy(f(5, 0.3), walls)).toEqual(['w'])
    // apoyado: el borde del mueble en y = 0,1
    expect(wallsHitBy(f(5, 0.6), walls)).toEqual([])
    expect(wallsHitBy(f(5, 3), walls)).toEqual([])
  })
})

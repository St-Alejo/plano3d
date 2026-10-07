/** Matemática pura del editor 2D: selección por caja y entrada numérica del largo. */
import type { Point, Wall } from '@/api/types'
import { modelBounds, type Bounds } from '@/domain/model'
import type { BuildingModel } from '@/api/types'

const inside = (p: Point, lo: Point, hi: Point) => p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y

/** ¿El segmento p–q toca el rectángulo? (recorte de Liang–Barsky) */
function segmentHitsBox(p: Point, q: Point, lo: Point, hi: Point): boolean {
  let t0 = 0
  let t1 = 1
  const d = { x: q.x - p.x, y: q.y - p.y }
  const edges: [number, number][] = [
    [-d.x, p.x - lo.x],
    [d.x, hi.x - p.x],
    [-d.y, p.y - lo.y],
    [d.y, hi.y - p.y],
  ]
  for (const [den, num] of edges) {
    if (den === 0) {
      if (num < 0) return false
      continue
    }
    const t = num / den
    if (den < 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
    if (t0 > t1) return false
  }
  return true
}

/**
 * Selección por caja como en CAD: arrastrando de izquierda a derecha ("ventana")
 * entran los muros completamente dentro; de derecha a izquierda ("cruce"), también
 * los que la caja solo toca.
 */
export function wallsInBox(walls: Wall[], a: Point, b: Point): Wall[] {
  const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }
  const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }
  const crossing = b.x < a.x
  return walls.filter((w) =>
    crossing ? segmentHitsBox(w.start, w.end, lo, hi) : inside(w.start, lo, hi) && inside(w.end, lo, hi),
  )
}

/**
 * Largo tecleado mientras se dibuja ("3,5", "3.50", "350cm"). Devuelve metros o null
 * si el texto no es un largo válido.
 */
export function parseLength(text: string): number | null {
  const t = text.trim().toLowerCase().replace(',', '.')
  const m = /^(\d+(?:\.\d*)?|\.\d+)\s*(m|cm)?$/.exec(t)
  if (!m) return null
  const v = Number(m[1]) * (m[2] === 'cm' ? 0.01 : 1)
  return v > 0 && Number.isFinite(v) ? v : null
}

/** Encuadre del plano: los muros y ambientes (en metros), o null si el modelo está vacío. */
export function contentBounds(model: BuildingModel | null): Bounds | null {
  if (!model || model.levels.every((l) => l.walls.length === 0 && l.rooms.length === 0)) return null
  return modelBounds(model)
}

/** ¿El punto cae dentro del polígono? (par/impar de cruces) */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

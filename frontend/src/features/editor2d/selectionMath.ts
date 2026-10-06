/** Matemática pura del editor 2D: selección por caja y entrada numérica del largo. */
import type { Point, Wall } from '@/api/types'
import { modelBounds, type Bounds } from '@/domain/model'
import type { BuildingModel } from '@/api/types'

const inside = (p: Point, lo: Point, hi: Point) => p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y

/** Muros completamente dentro del rectángulo a–b (en cualquier orden de esquinas). */
export function wallsInBox(walls: Wall[], a: Point, b: Point): Wall[] {
  const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }
  const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }
  return walls.filter((w) => inside(w.start, lo, hi) && inside(w.end, lo, hi))
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

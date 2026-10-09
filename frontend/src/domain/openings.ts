/** Colocar puertas y ventanas sobre un muro: dónde caben y cuánto queda a cada lado. */
import type { Opening, Wall } from '@/api/types'
import { EPS, wallLength } from './model'

export interface Placement {
  /** inicio de la abertura a lo largo del muro (m), ya ajustado y dentro del muro */
  offset: number
  /** cabe sin salirse del muro ni pisar otra abertura */
  ok: boolean
  /** distancia libre desde cada extremo del muro (m), para las cotas vivas */
  before: number
  after: number
}

/**
 * Ubica una abertura de ancho `width` centrada lo más cerca posible de `center`
 * (m a lo largo del muro), con paso `step` (0 = libre). `ignoreId` es la propia
 * abertura cuando se mueve dentro del mismo muro.
 */
export function placeOpening(wall: Wall, width: number, center: number, ignoreId?: string, step = 0.05): Placement {
  const len = wallLength(wall)
  let offset = center - width / 2
  if (step > 0) offset = Math.round(offset / step) * step
  offset = Math.min(Math.max(0, offset), Math.max(0, len - width))
  const ok = width <= len + EPS && !wall.openings.some((o) => o.id !== ignoreId && overlaps(o, offset, width))
  return { offset, ok, before: offset, after: Math.max(0, len - offset - width) }
}

function overlaps(o: Pick<Opening, 'offset' | 'width'>, offset: number, width: number): boolean {
  return offset < o.offset + o.width - EPS && o.offset < offset + width - EPS
}

/** Offset que deja la abertura centrada en el muro. */
export function centeredOffset(wall: Wall, width: number): number {
  return Math.max(0, (wallLength(wall) - width) / 2)
}

/** Muro y abertura por id de abertura (las aberturas viven dentro de su muro). */
export function findOpening(walls: Wall[], openingId: string): { wall: Wall; opening: Opening } | null {
  for (const wall of walls) {
    const opening = wall.openings.find((o) => o.id === openingId)
    if (opening) return { wall, opening }
  }
  return null
}

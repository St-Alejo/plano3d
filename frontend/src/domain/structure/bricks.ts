/**
 * Unidades de mampostería de arcilla comunes en Colombia (NTC 4205). Medidas en metros:
 * largo × ancho (grosor del muro) × alto, más la junta de mortero.
 */
export type BrickId = 'tolete' | 'bloque5'

export interface BrickUnit {
  id: BrickId
  name: string
  length: number
  width: number
  height: number
  /** junta de pega (horizontal y vertical) */
  joint: number
  /** macizo o de perforación horizontal (cambia el mortero de pega) */
  solid: boolean
}

export const BRICKS: Record<BrickId, BrickUnit> = {
  tolete: { id: 'tolete', name: 'Ladrillo tolete 24,5 × 12 × 6 cm', length: 0.245, width: 0.12, height: 0.06, joint: 0.01, solid: true },
  bloque5: { id: 'bloque5', name: 'Bloque Nº5 33 × 11,5 × 23 cm', length: 0.33, width: 0.115, height: 0.23, joint: 0.01, solid: false },
}

/** Alto de una hilada (pieza + junta). */
export const courseHeight = (b: BrickUnit) => b.height + b.joint
/** Largo de una pieza con su junta. */
export const brickPitch = (b: BrickUnit) => b.length + b.joint

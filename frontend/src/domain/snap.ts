/** Ajustes del editor 2D: imán a extremos existentes y a ejes 0°/90°. */
import type { Level, Point, Wall } from '@/api/types'
import { distance, projectOnWall } from './model'

export function wallEndpoints(walls: Wall[], exceptWallId?: string): Point[] {
  return walls.filter((w) => w.id !== exceptWallId).flatMap((w) => [w.start, w.end])
}

/** Devuelve el candidato más cercano dentro de `tol`, o el punto original. */
export function snapToPoints(p: Point, candidates: Point[], tol: number): { point: Point; snapped: boolean } {
  let best: Point | null = null
  let bestD = tol
  for (const c of candidates) {
    const d = distance(p, c)
    if (d <= bestD) {
      best = c
      bestD = d
    }
  }
  return best ? { point: { ...best }, snapped: true } : { point: p, snapped: false }
}

/** Si el segmento anchor→p está a menos de `degTol` de horizontal/vertical, lo endereza. */
export function snapToAxis(anchor: Point, p: Point, degTol = 6): Point {
  const dx = p.x - anchor.x
  const dy = p.y - anchor.y
  const ang = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI
  if (ang < degTol) return { x: p.x, y: anchor.y }
  if (90 - ang < degTol) return { x: anchor.x, y: p.y }
  return p
}

/** Redondea a la rejilla (paso en las mismas unidades que el punto; 0 = sin rejilla). */
export function snapToGrid(p: Point, step: number): Point {
  if (!(step > 0)) return p
  return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step }
}

/**
 * Combina los imanes, del más fuerte al más débil: extremos existentes → ejes 0°/90°
 * respecto del ancla → rejilla (sobre el eje libre, para no romper la alineación).
 */
export function snapPoint(
  p: Point,
  opts: { anchor?: Point; candidates: Point[]; tol: number; degTol?: number; grid?: number },
): Point {
  const s = snapToPoints(p, opts.candidates, opts.tol)
  if (s.snapped) return s.point
  const axis = opts.anchor ? snapToAxis(opts.anchor, p, opts.degTol) : p
  if (!opts.grid) return axis
  const g = snapToGrid(axis, opts.grid)
  if (opts.anchor && axis.y === opts.anchor.y) return { x: g.x, y: axis.y }
  if (opts.anchor && axis.x === opts.anchor.x) return { x: axis.x, y: g.y }
  return g
}

/** Muro más cercano a un punto (para colocar puertas/ventanas con un clic). */
export function nearestWall(level: Level, p: Point, tol: number): { wall: Wall; offset: number } | null {
  let best: { wall: Wall; offset: number; d: number } | null = null
  for (const w of level.walls) {
    const { offset, distance: d } = projectOnWall(w, p)
    if (d <= Math.max(tol, w.thickness / 2) && (!best || d < best.d)) best = { wall: w, offset, d }
  }
  return best ? { wall: best.wall, offset: best.offset } : null
}

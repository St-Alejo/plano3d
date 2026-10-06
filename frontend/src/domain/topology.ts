/**
 * Topología de muros: uniones (esquinas) y encuentros en T.
 *
 * Un plano no es una bolsa de segmentos sueltos: si se mueve una esquina, los dos
 * muros que la forman deben seguirla, y los muros que "nacen" del medio de otro
 * (encuentros en T) deben quedar apoyados sobre él. Todo aquí es puro y sin estado.
 */
import type { Level, Point, Wall } from '@/api/types'
import { distance, moveWallEndpoint, wallDirection, wallLength } from './model'

/** Dos extremos a menos de 1 cm se consideran la misma unión. */
export const JOINT_TOL = 0.01

export type End = 'start' | 'end'

export interface EndRef {
  wallId: string
  end: End
}

export function endpointsAt(walls: Wall[], p: Point, tol = JOINT_TOL): EndRef[] {
  const refs: EndRef[] = []
  for (const w of walls) {
    if (distance(w.start, p) <= tol) refs.push({ wallId: w.id, end: 'start' })
    if (distance(w.end, p) <= tol) refs.push({ wallId: w.id, end: 'end' })
  }
  return refs
}

/** Extremos de OTROS muros apoyados en el tramo interior de `host` (encuentro en T), con su posición relativa t∈(0,1). */
export function tJunctionsOn(walls: Wall[], host: Wall, tol = JOINT_TOL): (EndRef & { t: number })[] {
  const len = wallLength(host)
  const d = wallDirection(host)
  const out: (EndRef & { t: number })[] = []
  for (const w of walls) {
    if (w.id === host.id) continue
    for (const end of ['start', 'end'] as const) {
      const p = w[end]
      const along = (p.x - host.start.x) * d.x + (p.y - host.start.y) * d.y
      const perp = Math.abs(-(p.x - host.start.x) * d.y + (p.y - host.start.y) * d.x)
      // el extremo cae sobre la línea central (o dentro del grosor) y lejos de las puntas
      if (perp <= Math.max(tol, host.thickness / 2) && along > tol && along < len - tol) {
        out.push({ wallId: w.id, end, t: along / len })
      }
    }
  }
  return out
}

export interface JointMove {
  from: Point
  to: Point
}

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

/**
 * Aplica movimientos de uniones y devuelve SOLO los muros modificados.
 * - Todo extremo que coincide con `from` pasa a `to`.
 * - Los extremos en T sobre un muro modificado conservan su posición relativa sobre él.
 * - Si un muro se desplaza entero (ambos extremos con el mismo vector), sus aberturas
 *   se quedan donde estaban respecto del muro; si solo cambia el inicio, se mantienen en su
 *   posición absoluta (como `moveWallEndpoint`).
 */
export function applyJointMoves(level: Level, moves: JointMove[], only?: Set<string>): Map<string, Wall> {
  const byId = new Map(level.walls.map((w) => [w.id, w]))
  const target = (p: Point): Point | null => {
    for (const m of moves) if (distance(p, m.from) <= JOINT_TOL) return m.to
    return null
  }

  // encuentros en T antes de mover: se recalculan después sobre el anfitrión nuevo
  const tLinks: { host: string; ref: EndRef; t: number }[] = []
  for (const host of level.walls) for (const ref of tJunctionsOn(level.walls, host)) tLinks.push({ host: host.id, ref, t: ref.t })

  const changed = new Map<string, Wall>()
  for (const w of level.walls) {
    if (only && !only.has(w.id)) continue
    const s = target(w.start)
    const e = target(w.end)
    if (!s && !e) continue
    const newStart = s ?? w.start
    const newEnd = e ?? w.end
    const ds = { x: newStart.x - w.start.x, y: newStart.y - w.start.y }
    const de = { x: newEnd.x - w.end.x, y: newEnd.y - w.end.y }
    const rigid = Math.hypot(ds.x - de.x, ds.y - de.y) < 1e-9
    const next = rigid ? { ...w, start: newStart, end: newEnd } : moveWallEndpoint(moveWallEndpoint(w, 'end', newEnd), 'start', newStart)
    changed.set(w.id, next)
  }

  for (const link of tLinks) {
    const hostNew = changed.get(link.host)
    if (!hostNew) continue
    const dependent = changed.get(link.ref.wallId) ?? byId.get(link.ref.wallId)
    if (!dependent) continue
    // si el propio extremo ya se movió por una unión explícita, esa manda
    if (target(byId.get(link.ref.wallId)![link.ref.end])) continue
    const p = anchoredPoint(byId.get(link.host)!, hostNew, link.t)
    if (distance(p, dependent[link.ref.end]) < 1e-9) continue // no se movió: no es un cambio
    changed.set(dependent.id, moveWallEndpoint(dependent, link.ref.end, p))
  }
  return changed
}

/**
 * Dónde queda un encuentro en T cuando su muro anfitrión cambia.
 * - Si solo se movió una punta del anfitrión, la T conserva su distancia a la punta FIJA
 *   (estirar una fachada no desplaza los muros interiores que nacen de ella).
 * - Si el anfitrión se trasladó entero, la T se traslada con él.
 * - Si cambiaron ambas puntas de forma distinta (giro), conserva su posición relativa.
 */
function anchoredPoint(oldHost: Wall, newHost: Wall, t: number): Point {
  const along = t * wallLength(oldHost)
  const startMoved = distance(oldHost.start, newHost.start) > 1e-9
  const endMoved = distance(oldHost.end, newHost.end) > 1e-9
  const dir = wallDirection(newHost)
  if (!startMoved && endMoved) return { x: newHost.start.x + dir.x * along, y: newHost.start.y + dir.y * along }
  if (startMoved && !endMoved) {
    const fromEnd = wallLength(oldHost) - along
    return { x: newHost.end.x - dir.x * fromEnd, y: newHost.end.y - dir.y * fromEnd }
  }
  const ds = { x: newHost.start.x - oldHost.start.x, y: newHost.start.y - oldHost.start.y }
  const de = { x: newHost.end.x - oldHost.end.x, y: newHost.end.y - oldHost.end.y }
  if (Math.hypot(ds.x - de.x, ds.y - de.y) < 1e-9) {
    const old = lerp(oldHost.start, oldHost.end, t)
    return { x: old.x + ds.x, y: old.y + ds.y }
  }
  return lerp(newHost.start, newHost.end, t)
}

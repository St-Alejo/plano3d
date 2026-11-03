/**
 * Geometría de la fachada (pura, sin WebGL): de qué lado queda la calle en cada muro de
 * fachada y la piel que lo viste por fuera. La piel se arma con las mismas cajas del muro
 * (`wallToBoxes`), así respeta cada vano sin operaciones booleanas.
 */
import type { Level, Point, Wall } from '@/api/types'
import { wallToBoxes, type Box } from './geometry'
import { wallDirection, wallLength } from './model'

/** Grosor de la piel de revestimiento (m). */
export const SKIN = 0.02
/** Cuánto se separa del eje el punto de prueba más allá de la cara del muro. */
const PROBE = 0.25

function inside(p: Point, poly: Point[]): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

/** Normal izquierda del muro en planta: (-dy, dx). */
export function leftNormal(w: Pick<Wall, 'start' | 'end'>): Point {
  const d = wallDirection(w)
  return { x: -d.y, y: d.x }
}

/**
 * +1 si la calle queda del lado de la normal izquierda del muro; -1 si del otro. Afuera es
 * el lado que no cae en ningún ambiente; si los dos caen fuera (un muro suelto), el más
 * lejos del centro de la planta.
 */
export function outwardSign(w: Wall, lv: Level): 1 | -1 {
  const n = leftNormal(w)
  const len = wallLength(w)
  const d = wallDirection(w)
  const reach = w.thickness / 2 + PROBE
  const score = (s: 1 | -1): number => {
    let hits = 0
    for (const t of [0.25, 0.5, 0.75]) {
      const p = { x: w.start.x + d.x * len * t + n.x * reach * s, y: w.start.y + d.y * len * t + n.y * reach * s }
      if (lv.rooms.some((r) => inside(p, r.polygon))) hits++
    }
    return hits
  }
  const left = score(1)
  const right = score(-1)
  if (left !== right) return left < right ? 1 : -1
  const xs = lv.walls.flatMap((x) => [x.start.x, x.end.x])
  const ys = lv.walls.flatMap((x) => [x.start.y, x.end.y])
  const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
  const mid = { x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 }
  return (mid.x - c.x) * n.x + (mid.y - c.y) * n.y >= 0 ? 1 : -1
}

/**
 * Piel exterior de un muro: cada caja del muro (macizos, antepechos, dinteles) copiada con
 * `SKIN` de grosor sobre la cara de afuera. Las de los extremos se alargan para cerrar la
 * esquina con la piel del muro vecino.
 */
export function skinBoxes(w: Wall, side: 1 | -1, skin = SKIN): Box[] {
  const n = leftNormal(w)
  const d = wallDirection(w)
  const len = wallLength(w)
  const off = (w.thickness / 2 + skin / 2) * side
  return wallToBoxes(w).map((b) => {
    const along = (b.center[0] - w.start.x) * d.x + (b.center[2] - w.start.y) * d.y
    let a0 = along - b.size[0] / 2
    let a1 = along + b.size[0] / 2
    if (a0 <= -w.thickness / 2 + 1e-4) a0 -= skin
    if (a1 >= len + w.thickness / 2 - 1e-4) a1 += skin
    const mid = (a0 + a1) / 2
    return {
      ...b,
      center: [w.start.x + d.x * mid + n.x * off, b.center[1], w.start.y + d.y * mid + n.y * off],
      size: [a1 - a0, b.size[1], skin],
    }
  })
}

/** Dirección de la calle: la normal exterior de los muros con portón del primer piso. */
export function frontNormal(ground: Level): Point | null {
  for (const w of ground.walls) {
    if (w.kind !== 'exterior' || w.bulge) continue
    if (!w.openings.some((o) => o.operation === 'folding')) continue
    const n = leftNormal(w)
    const s = outwardSign(w, ground)
    return { x: n.x * s, y: n.y * s }
  }
  return null
}

/**
 * Punto en la calle frente al portón del garaje (o la puerta exterior más ancha del primer
 * piso), a `distance` m de la fachada y mirando hacia ella: el inicio del recorrido.
 */
export function streetEntry(ground: Level, distance = 2.5): { x: number; y: number; levelId: string; facing: Point } | null {
  let best: { w: Wall; offset: number; width: number; score: number } | null = null
  for (const w of ground.walls) {
    if (w.kind !== 'exterior' || w.bulge) continue
    for (const o of w.openings) {
      if (o.kind !== 'door') continue
      const score = o.width + (o.operation === 'folding' ? 10 : 0)
      if (!best || score > best.score) best = { w, offset: o.offset, width: o.width, score }
    }
  }
  if (!best) return null
  const { w } = best
  const d = wallDirection(w)
  const n = leftNormal(w)
  const s = outwardSign(w, ground)
  const along = best.offset + best.width / 2
  const out = { x: n.x * s, y: n.y * s }
  return {
    x: w.start.x + d.x * along + out.x * distance,
    y: w.start.y + d.y * along + out.y * distance,
    levelId: ground.id,
    facing: { x: -out.x, y: -out.y },
  }
}

/** ¿El muro es de la fachada principal (mira a la calle y es el más adelantado)? */
export function isFront(w: Wall, lv: Level, front: Point | null): boolean {
  if (!front || w.kind !== 'exterior' || w.bulge) return false
  const n = leftNormal(w)
  const s = outwardSign(w, lv)
  if ((n.x * front.x + n.y * front.y) * s < 0.9) return false
  const proj = (p: Point) => p.x * front.x + p.y * front.y
  const ext = lv.walls.filter((x) => x.kind === 'exterior').flatMap((x) => [proj(x.start), proj(x.end)])
  return Math.max(proj(w.start), proj(w.end)) >= Math.max(...ext) - 0.5
}

/**
 * Ladrillo pieza por pieza: cada paño de mampostería se reparte en hiladas con trabado a
 * soga (media pieza de corrimiento entre hiladas), con piezas cortadas en los bordes y sin
 * invadir vanos, dinteles ni columnetas. La traba se mide desde el inicio del muro, así las
 * juntas siguen alineadas aunque el muro esté partido en varios paños.
 */
import type { BuildingModel, Wall } from '@/api/types'
import { brickPitch, courseHeight, type BrickUnit } from './bricks'
import { brickOf, type MasonryPanel, type Structure } from './derive'

export interface Brick {
  wallId: string
  panelId: string
  levelId: string
  /** centro a lo largo del eje del muro */
  along: number
  /** cota inferior absoluta de la pieza */
  bottom: number
  length: number
  height: number
  course: number
  /** pieza cortada (no entera) */
  cut: boolean
}

/** Pieza más corta que vale la pena poner (lo demás se rellena con mortero). */
const MIN_PIECE = 0.04

/** Tramos libres [a, b] de un intervalo después de quitarle los huecos. */
function subtract(from: number, to: number, holes: [number, number][]): [number, number][] {
  let free: [number, number][] = [[from, to]]
  for (const [a, b] of holes) {
    free = free.flatMap(([x, y]): [number, number][] => {
      if (b <= x || a >= y) return [[x, y]]
      const out: [number, number][] = []
      if (a > x) out.push([x, a])
      if (b < y) out.push([b, y])
      return out
    })
  }
  return free
}

/** Huecos de un muro a la altura [y0, y1]: vanos y los dinteles que los coronan. */
function holesAt(w: Wall, elevation: number, s: Structure, y0: number, y1: number): [number, number][] {
  const holes: [number, number][] = []
  for (const o of w.openings) {
    const lo = elevation + o.sill
    const hi = elevation + o.sill + o.height
    if (y1 > lo + 1e-6 && y0 < hi - 1e-6) holes.push([o.offset, o.offset + o.width])
  }
  for (const l of s.lintels.filter((x) => x.wallId === w.id)) {
    if (y1 > l.bottom + 1e-6 && y0 < l.bottom + l.height - 1e-6) {
      const dx = l.start.x - w.start.x
      const dy = l.start.y - w.start.y
      const a = Math.hypot(dx, dy)
      const len = Math.hypot(l.end.x - l.start.x, l.end.y - l.start.y)
      holes.push([a, a + len])
    }
  }
  return holes
}

export function layPanel(p: MasonryPanel, w: Wall, elevation: number, s: Structure, unit: BrickUnit): Brick[] {
  const ch = courseHeight(unit)
  const pitch = brickPitch(unit)
  const bricks: Brick[] = []
  const courses = Math.ceil((p.top - p.bottom) / ch - 1e-6)
  for (let c = 0; c < courses; c++) {
    const y0 = p.bottom + c * ch
    const h = Math.min(unit.height, p.top - y0 - unit.joint / 2)
    if (h < 0.02) continue
    const shift = c % 2 === 0 ? 0 : pitch / 2
    for (const [a, b] of subtract(p.from, p.to, holesAt(w, elevation, s, y0, y0 + h))) {
      // juntas verticales en múltiplos del paso desde el inicio del muro (más el corrimiento)
      let k = Math.floor((a + shift) / pitch)
      for (;;) {
        const start = k * pitch - shift
        const x0 = Math.max(a, start + unit.joint / 2)
        const x1 = Math.min(b, start + pitch - unit.joint / 2)
        k++
        if (start >= b) break
        if (x1 - x0 < MIN_PIECE) continue
        bricks.push({ wallId: w.id, panelId: p.id, levelId: p.levelId, along: (x0 + x1) / 2, bottom: y0, length: x1 - x0, height: h, course: c, cut: x1 - x0 < unit.length - 1e-6 })
      }
    }
  }
  return bricks
}

/** Todas las piezas de la casa. */
export function masonryLayout(model: BuildingModel, s: Structure): Brick[] {
  const unit = brickOf(s)
  const walls = new Map(model.levels.flatMap((l) => l.walls.map((w) => [w.id, { w, elevation: l.elevation }] as const)))
  return s.panels.flatMap((p) => {
    const found = walls.get(p.wallId)
    return found ? layPanel(p, found.w, found.elevation, s, unit) : []
  })
}

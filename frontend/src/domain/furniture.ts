/**
 * Geometría de un mueble colocado: huella en planta y choque con muros.
 * La rotación gira las coordenadas locales (x ancho, z fondo) hacia la planta (x, y).
 */
import type { Furniture, Point, Wall } from '@/api/types'
import { obstaclesFromWalls, type Obstacle } from './collision'

/** Punto local (x, z) del mueble llevado a la planta. */
export function toPlan(f: Pick<Furniture, 'position' | 'rotation'>, x: number, z: number): Point {
  const c = Math.cos(f.rotation ?? 0)
  const s = Math.sin(f.rotation ?? 0)
  return { x: f.position.x + x * c - z * s, y: f.position.y + x * s + z * c }
}

/** Esquinas de la huella, en orden. */
export function footprint(f: Furniture): Point[] {
  const w = f.width / 2
  const d = f.depth / 2
  return [toPlan(f, -w, -d), toPlan(f, w, -d), toPlan(f, w, d), toPlan(f, -w, d)]
}

const obstacleCorners = (o: Obstacle): Point[] => {
  const ax = { x: o.cos * o.halfLen, y: o.sin * o.halfLen }
  const ay = { x: -o.sin * o.halfThick, y: o.cos * o.halfThick }
  return [
    { x: o.cx - ax.x - ay.x, y: o.cy - ax.y - ay.y },
    { x: o.cx + ax.x - ay.x, y: o.cy + ax.y - ay.y },
    { x: o.cx + ax.x + ay.x, y: o.cy + ax.y + ay.y },
    { x: o.cx - ax.x + ay.x, y: o.cy - ax.y + ay.y },
  ]
}

/** Separación por ejes (SAT) entre dos polígonos convexos. */
function convexOverlap(a: Point[], b: Point[], margin: number): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!
      const q = poly[(i + 1) % poly.length]!
      const n = { x: -(q.y - p.y), y: q.x - p.x }
      const len = Math.hypot(n.x, n.y) || 1
      const proj = (pts: Point[]) => pts.map((v) => (v.x * n.x + v.y * n.y) / len)
      const pa = proj(a)
      const pb = proj(b)
      if (Math.max(...pa) - margin <= Math.min(...pb) || Math.max(...pb) - margin <= Math.min(...pa)) return false
    }
  }
  return true
}

/**
 * Ids de los muros que la huella del mueble atraviesa. Se tolera un margen (2 cm) para
 * que un mueble apoyado contra un muro no cuente como choque.
 */
export function wallsHitBy(f: Furniture, walls: Wall[], margin = 0.02): string[] {
  const fp = footprint(f)
  const hits = new Set<string>()
  for (const w of walls) {
    if (obstaclesFromWalls([w]).some((o) => convexOverlap(fp, obstacleCorners(o), margin))) hits.add(w.id)
  }
  return [...hits]
}

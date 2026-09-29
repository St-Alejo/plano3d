/**
 * Colisión del modo "Recorrer": la persona es un círculo en planta y los muros
 * son rectángulos orientados. Solo bloquean los bloques que llegan al suelo
 * (tramos macizos y antepechos), así las puertas se pueden atravesar y las
 * ventanas no.
 */
import type { Point, Wall } from '@/api/types'
import { wallToBoxes, type Box } from './geometry'

export interface Obstacle {
  cx: number
  cy: number
  halfLen: number
  halfThick: number
  cos: number
  sin: number
}

const BLOCKING_HEIGHT = 1.0

export function obstaclesFromWalls(walls: Wall[]): Obstacle[] {
  return walls.flatMap((w) =>
    wallToBoxes(w)
      .filter((b) => b.center[1] - b.size[1] / 2 < BLOCKING_HEIGHT)
      .map(toObstacle),
  )
}

function toObstacle(b: Box): Obstacle {
  // rotationY = -atan2(dy, dx) → dirección en planta = (cos(-r), sin(-r))
  const angle = -b.rotationY
  return {
    cx: b.center[0],
    cy: b.center[2],
    halfLen: b.size[0] / 2,
    halfThick: b.size[2] / 2,
    cos: Math.cos(angle),
    sin: Math.sin(angle),
  }
}

/** Empuja la posición fuera de cada obstáculo que la solape. Varias pasadas por esquinas. */
export function resolveCollision(pos: Point, obstacles: Obstacle[], radius: number, passes = 3): Point {
  let { x, y } = pos
  for (let pass = 0; pass < passes; pass++) {
    let moved = false
    for (const o of obstacles) {
      // a coordenadas locales del rectángulo
      const dx = x - o.cx
      const dy = y - o.cy
      const lx = dx * o.cos + dy * o.sin
      const ly = -dx * o.sin + dy * o.cos
      const qx = Math.max(-o.halfLen, Math.min(o.halfLen, lx))
      const qy = Math.max(-o.halfThick, Math.min(o.halfThick, ly))
      let nx = lx - qx
      let ny = ly - qy
      let dist = Math.hypot(nx, ny)
      if (dist >= radius) continue
      if (dist < 1e-9) {
        // el centro quedó dentro: se sale por la cara más cercana
        const penX = o.halfLen - Math.abs(lx)
        const penY = o.halfThick - Math.abs(ly)
        if (penX < penY) {
          nx = Math.sign(lx) || 1
          ny = 0
          dist = -penX
        } else {
          nx = 0
          ny = Math.sign(ly) || 1
          dist = -penY
        }
      } else {
        nx /= dist
        ny /= dist
      }
      const push = radius - dist
      const plx = lx + nx * push
      const ply = ly + ny * push
      x = o.cx + plx * o.cos - ply * o.sin
      y = o.cy + plx * o.sin + ply * o.cos
      moved = true
    }
    if (!moved) break
  }
  return { x, y }
}

/** Distancia libre desde `from` en la dirección `angle` (radianes, en planta) hasta el primer obstáculo. */
export function freeDistance(from: Point, angle: number, obstacles: Obstacle[], maxDist = 50, step = 0.1): number {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  for (let d = step; d <= maxDist; d += step) {
    const p = { x: from.x + dx * d, y: from.y + dy * d }
    for (const o of obstacles) {
      const lx = (p.x - o.cx) * o.cos + (p.y - o.cy) * o.sin
      const ly = -(p.x - o.cx) * o.sin + (p.y - o.cy) * o.cos
      if (Math.abs(lx) <= o.halfLen && Math.abs(ly) <= o.halfThick) return d
    }
  }
  return maxDist
}

/**
 * Hacia dónde mirar al empezar a caminar: la dirección con más espacio libre
 * (así no se arranca con la cara contra un muro). Devuelve el ángulo en planta.
 */
export function bestViewAngle(from: Point, obstacles: Obstacle[], samples = 16): number {
  let best = 0
  let bestD = -1
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2
    const d = freeDistance(from, a, obstacles)
    if (d > bestD + 1e-9) {
      best = a
      bestD = d
    }
  }
  return best
}

/**
 * Geometría 3D pura (sin WebGL): de BuildingModel a cajas y polígonos.
 *
 * Aberturas SIN operaciones booleanas (CSG): el muro se parte en bloques
 * alrededor de cada hueco — tramos macizos, antepecho bajo la ventana y dintel
 * sobre puertas/ventanas. Es determinista y la malla queda cerrada por construcción.
 */
import type { Point, Room, Wall } from '@/api/types'
import { polygonCentroid, wallDirection, wallLength } from './model'

export interface Box {
  /** centro en coordenadas 3D (X = x planta, Y = arriba, Z = y planta) */
  center: [number, number, number]
  /** [largo a lo largo del muro, alto, grosor] */
  size: [number, number, number]
  /** rotación alrededor de Y (radianes) */
  rotationY: number
  part: 'solid' | 'sill' | 'lintel'
}

export function wallToBoxes(w: Wall): Box[] {
  const len = wallLength(w)
  const dir = wallDirection(w)
  const rotationY = -Math.atan2(dir.y, dir.x)
  const at = (along: number, from: number, to: number, part: Box['part']): Box => ({
    center: [w.start.x + dir.x * along, (from + to) / 2, w.start.y + dir.y * along],
    size: [0, to - from, w.thickness],
    rotationY,
    part,
  })
  const boxes: Box[] = []
  const push = (a: number, b: number, from: number, to: number, part: Box['part']): void => {
    if (b - a <= 1e-4 || to - from <= 1e-4) return
    const box = at((a + b) / 2, from, to, part)
    box.size[0] = b - a
    boxes.push(box)
  }
  // los extremos se alargan medio grosor para que las esquinas cierren sin huecos
  const ext = w.thickness / 2
  const openings = [...w.openings].sort((a, b) => a.offset - b.offset)
  let cursor = -ext
  for (const o of openings) {
    const start = Math.max(cursor, o.offset)
    push(cursor, start, 0, w.height, 'solid')
    const end = Math.min(len, o.offset + o.width)
    push(start, end, 0, o.sill, 'sill')
    push(start, end, Math.min(w.height, o.sill + o.height), w.height, 'lintel')
    cursor = end
  }
  push(cursor, len + ext, 0, w.height, 'solid')
  return boxes
}

export function boxVolume(b: Box): number {
  return b.size[0] * b.size[1] * b.size[2]
}

/**
 * Puntos del contorno para THREE.Shape. La forma se dibuja en el plano XY y
 * luego se rota -90° en X, lo que manda y_shape → -Z; por eso se niega y.
 */
export function roomShapePoints(r: Room): [number, number][] {
  return r.polygon.map((p) => [p.x, -p.y])
}

/** Puntos de paso para el recorrido guiado: centro de cada ambiente, de mayor a menor. */
export function tourWaypoints(rooms: Room[]): { id: string; label: string; at: Point }[] {
  return [...rooms]
    .sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true }))
    .map((r) => ({ id: r.id, label: r.label, at: polygonCentroid(r.polygon) }))
}

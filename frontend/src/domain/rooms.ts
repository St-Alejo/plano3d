/**
 * Ambientes derivados de los muros.
 *
 * Los ambientes son el espacio libre encerrado por los muros: se unen los muros
 * (con su grosor y sin descontar aberturas, para que las puertas no "abran" el
 * ambiente) y cada agujero de esa unión es un ambiente. Así el área siempre
 * corresponde a la geometría actual. Los nombres se conservan emparejando por
 * superposición (IoU) con los ambientes anteriores.
 */
import polygonClipping, { type MultiPolygon, type Polygon as PCPolygon, type Ring } from 'polygon-clipping'
import type { Level, Point, Room, Wall } from '@/api/types'
import { wallAxis } from './geometry'
import { newId, polygonArea, wallDirection } from './model'

export const MIN_ROOM_AREA = 0.5 // m²
const MATCH_IOU = 0.3

function wallRect(w: Wall): PCPolygon {
  if (w.bulge) return curvedFootprint(w)
  const d = wallDirection(w)
  const n = { x: -d.y, y: d.x }
  const h = w.thickness / 2
  // se alarga medio grosor en cada punta para que las esquinas cierren
  const a = { x: w.start.x - d.x * h, y: w.start.y - d.y * h }
  const b = { x: w.end.x + d.x * h, y: w.end.y + d.y * h }
  const ring: Ring = [
    [a.x + n.x * h, a.y + n.y * h],
    [b.x + n.x * h, b.y + n.y * h],
    [b.x - n.x * h, b.y - n.y * h],
    [a.x - n.x * h, a.y - n.y * h],
    [a.x + n.x * h, a.y + n.y * h],
  ]
  return [ring]
}

/** Huella de un muro curvo: el eje muestreado desplazado medio grosor a cada lado. */
function curvedFootprint(w: Wall): PCPolygon {
  const pts = wallAxis(w, 0.1)
  const h = w.thickness / 2
  const left: [number, number][] = []
  const right: [number, number][] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]!
    const b = pts[Math.min(pts.length - 1, i + 1)]!
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = -(b.y - a.y) / len
    const ny = (b.x - a.x) / len
    const p = pts[i]!
    left.push([p.x + nx * h, p.y + ny * h])
    right.push([p.x - nx * h, p.y - ny * h])
  }
  const ring: Ring = [...left, ...right.reverse()]
  ring.push(ring[0]!)
  return [ring]
}

/** Quita el punto de cierre repetido y los vértices colineales. */
function cleanRing(ring: Ring): Point[] {
  const pts = ring.map(([x, y]) => ({ x, y }))
  if (pts.length > 1) {
    const f = pts[0]!
    const l = pts[pts.length - 1]!
    if (Math.abs(f.x - l.x) < 1e-12 && Math.abs(f.y - l.y) < 1e-12) pts.pop()
  }
  const out: Point[] = []
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length]!
    const cur = pts[i]!
    const next = pts[(i + 1) % pts.length]!
    const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x)
    if (Math.abs(cross) > 1e-9) out.push({ x: round(cur.x), y: round(cur.y) })
  }
  return out
}

const round = (v: number) => Math.round(v * 1e6) / 1e6

const toPC = (poly: Point[]): PCPolygon => [[...poly.map((p): [number, number] => [p.x, p.y]), [poly[0]!.x, poly[0]!.y]]]

function mpArea(mp: MultiPolygon): number {
  let a = 0
  for (const poly of mp) {
    poly.forEach((ring, i) => {
      const area = polygonArea(ring.map(([x, y]) => ({ x, y })))
      a += i === 0 ? area : -area
    })
  }
  return a
}

export function polygonIoU(a: Point[], b: Point[]): number {
  if (a.length < 3 || b.length < 3) return 0
  const inter = mpArea(polygonClipping.intersection(toPC(a), toPC(b)))
  if (inter <= 0) return 0
  const uni = mpArea(polygonClipping.union(toPC(a), toPC(b)))
  return uni > 0 ? inter / uni : 0
}

/** Polígonos libres encerrados por los muros (sin nombres). */
export function enclosedSpaces(walls: Wall[], minArea = MIN_ROOM_AREA): Point[][] {
  if (walls.length === 0) return []
  const [first, ...rest] = walls.map(wallRect)
  const union = polygonClipping.union(first!, ...rest)
  const spaces: Point[][] = []
  for (const poly of union) {
    for (const hole of poly.slice(1)) {
      const pts = cleanRing(hole)
      if (pts.length >= 3 && polygonArea(pts) >= minArea) spaces.push(pts)
    }
  }
  // orden de lectura: arriba→abajo, izquierda→derecha (como la detección)
  const c = (p: Point[]) => ({ x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length })
  return spaces.sort((a, b) => Math.round(c(a).y * 2) - Math.round(c(b).y * 2) || c(a).x - c(b).x)
}

/**
 * Recalcula los ambientes del nivel conservando id, nombre y confianza de los que
 * siguen existiendo (emparejados por IoU ≥ 0.3). Los nuevos se llaman "Espacio N".
 */
export function recomputeRooms(level: Level): Room[] {
  const spaces = enclosedSpaces(level.walls)
  const pairs: { iou: number; s: number; r: number }[] = []
  spaces.forEach((sp, s) =>
    level.rooms.forEach((room, r) => {
      const iou = polygonIoU(sp, room.polygon)
      if (iou >= MATCH_IOU) pairs.push({ iou, s, r })
    }),
  )
  pairs.sort((a, b) => b.iou - a.iou)
  const bySpace = new Map<number, Room>()
  const usedRooms = new Set<number>()
  for (const p of pairs) {
    if (bySpace.has(p.s) || usedRooms.has(p.r)) continue
    bySpace.set(p.s, level.rooms[p.r]!)
    usedRooms.add(p.r)
  }

  const taken = new Set(level.rooms.map((r) => r.label))
  let n = 1
  const nextLabel = () => {
    while (taken.has(`Espacio ${n}`)) n++
    taken.add(`Espacio ${n}`)
    return `Espacio ${n}`
  }
  return spaces.map((polygon, s) => {
    const prev = bySpace.get(s)
    return prev ? { ...prev, polygon, area: undefined, centroid: undefined } : { id: newId('r'), label: nextLabel(), polygon, confidence: 1 }
  })
}

/** ¿Cambió algo relevante (cantidad o geometría) entre dos listas de ambientes? */
export function roomsDiffer(a: Room[], b: Room[]): boolean {
  if (a.length !== b.length) return true
  return a.some((r, i) => {
    const o = b[i]!
    return r.id !== o.id || r.polygon.length !== o.polygon.length || r.polygon.some((p, j) => Math.abs(p.x - o.polygon[j]!.x) > 1e-6 || Math.abs(p.y - o.polygon[j]!.y) > 1e-6)
  })
}

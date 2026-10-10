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

// ---------------------------------------------------------------------- modelo v2 (ADR-012)

/**
 * Eje de un muro curvo muestreado (la misma convención que el backend: `bulge` > 0
 * curva hacia la normal izquierda (-dy, dx) de start → end). Recto: [start, end].
 */
export function wallAxis(w: Pick<Wall, 'start' | 'end'> & { bulge?: number | null }, step = 0.25): Point[] {
  const s = w.bulge ?? 0
  if (Math.abs(s) < 1e-6) return [w.start, w.end]
  const c = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y)
  const r = (c * c) / 4 / (2 * Math.abs(s)) + Math.abs(s) / 2
  const ux = (w.end.x - w.start.x) / c
  const uy = (w.end.y - w.start.y) / c
  const nx = -uy
  const ny = ux
  const sign = s > 0 ? 1 : -1
  const d = r - Math.abs(s)
  const mx = (w.start.x + w.end.x) / 2
  const my = (w.start.y + w.end.y) / 2
  const cx = mx - sign * nx * d
  const cy = my - sign * ny * d
  const a0 = Math.atan2(w.start.y - cy, w.start.x - cx)
  const half = 2 * Math.asin(Math.min(1, c / (2 * r)))
  const theta = Math.abs(s) <= r ? half : 2 * Math.PI - half
  // la flecha a la izquierda equivale a girar en sentido horario en pantalla (y abajo)
  let sweep = s > 0 ? -theta : theta
  // si el barrido no llega al extremo final, es el otro sentido
  const end = a0 + sweep
  if (Math.hypot(cx + r * Math.cos(end) - w.end.x, cy + r * Math.sin(end) - w.end.y) > 1e-6 * (1 + r)) {
    sweep = -sweep
  }
  const n = Math.max(6, Math.ceil((Math.abs(sweep) * r) / step))
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: cx + r * Math.cos(a0 + (sweep * i) / n),
    y: cy + r * Math.sin(a0 + (sweep * i) / n),
  }))
}

/** Cajas de un muro curvo: un bloque por cuerda del arco (se solapan para no dejar ranuras). */
export function curvedWallBoxes(w: Wall): Box[] {
  const pts = wallAxis(w)
  const boxes: Box[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    boxes.push({
      center: [(a.x + b.x) / 2, w.height / 2, (a.y + b.y) / 2],
      size: [len + w.thickness * 0.15, w.height, w.thickness],
      rotationY: -Math.atan2(b.y - a.y, b.x - a.x),
      part: 'solid',
    })
  }
  return boxes
}

export interface StepBox {
  center: [number, number, number]
  size: [number, number, number]
  rotationY: number
}

interface StairLike {
  start: Point
  end: Point
  width: number
  steps: number
  riser: number
  /** altura de arranque del tramo (escaleras en L o en U); 0 si falta */
  base?: number | null
}

/** Peldaños macizos de un tramo recto: cada uno llega hasta el piso (escalera maciza). */
export function stairSteps(s: StairLike): StepBox[] {
  const dx = s.end.x - s.start.x
  const dy = s.end.y - s.start.y
  const run = Math.hypot(dx, dy)
  if (run <= 0 || s.steps < 1) return []
  const ux = dx / run
  const uy = dy / run
  const tread = run / s.steps
  return Array.from({ length: s.steps }, (_, i) => {
    const along = tread * (i + 0.5)
    const h = (s.base ?? 0) + s.riser * (i + 1)
    return {
      center: [s.start.x + ux * along, h / 2, s.start.y + uy * along] as [number, number, number],
      size: [tread, h, s.width] as [number, number, number],
      rotationY: -Math.atan2(uy, ux),
    }
  })
}

interface OpeningLike {
  offset: number
  width: number
  height: number
  hinge_at_end?: boolean | null
  opens_left?: boolean | null
}

/**
 * Hoja de puerta entreabierta (30°) girando sobre su bisagra, hacia el lado que abre.
 * Devuelve el centro de la hoja y su rotación en Y.
 */
export function doorLeaf(w: Pick<Wall, 'start' | 'end' | 'thickness'>, o: OpeningLike, openDeg = 30): StepBox {
  const dir = wallDirection(w)
  const hingeOffset = o.hinge_at_end ? o.offset + o.width : o.offset
  const hinge = { x: w.start.x + dir.x * hingeOffset, y: w.start.y + dir.y * hingeOffset }
  // la hoja apunta hacia el otro lado del vano y gira hacia la normal en la que abre
  const along = o.hinge_at_end ? -1 : 1
  const base = Math.atan2(dir.y * along, dir.x * along)
  const side = (o.opens_left ?? true) ? 1 : -1
  // normal izquierda (-dy, dx) en pantalla = ángulo base - 90° si se avanza en +dir
  const a = base + (side * along * -openDeg * Math.PI) / 180
  const cx = hinge.x + (Math.cos(a) * o.width) / 2
  const cy = hinge.y + (Math.sin(a) * o.width) / 2
  return {
    center: [cx, o.height / 2, cy],
    size: [o.width, o.height, 0.04],
    rotationY: -a,
  }
}

/**
 * Puerta corrediza: dos hojas cerradas que se solapan un poco en el centro, cada una a
 * un lado del eje del muro (como se dibujan en planta).
 */
export function slidingLeaves(w: Pick<Wall, 'start' | 'end' | 'thickness'>, o: OpeningLike): StepBox[] {
  const dir = wallDirection(w)
  const n = { x: -dir.y, y: dir.x }
  const leaf = o.width * 0.55
  const depth = w.thickness / 4
  const rotationY = -Math.atan2(dir.y, dir.x)
  return [
    { at: o.offset + leaf / 2, side: -1 },
    { at: o.offset + o.width - leaf / 2, side: 1 },
  ].map(({ at, side }) => ({
    center: [w.start.x + dir.x * at + n.x * depth * side, o.height / 2, w.start.y + dir.y * at + n.y * depth * side],
    size: [leaf, o.height, 0.03],
    rotationY,
  }))
}

/** Hoja batiente lista para animar: gira en Y sobre su bisagra entre `closed` y `open`. */
export interface HingedLeaf {
  /** bisagra en planta */
  hinge: Point
  width: number
  height: number
  /** rotación Y del pivote con la puerta cerrada y abierta (90°) */
  closed: number
  open: number
}

/**
 * Hojas batientes de una puerta: una (batiente) o dos (doble batiente, cada una de la mitad
 * del vano). Con el pivote en la bisagra, abrir es interpolar la rotación.
 */
export function swingLeaves(w: Pick<Wall, 'start' | 'end'>, o: OpeningLike & { operation?: string | null }, openDeg = 90): HingedLeaf[] {
  const dir = wallDirection(w)
  const side = (o.opens_left ?? true) ? 1 : -1
  const leaf = (hingeOffset: number, along: 1 | -1, width: number): HingedLeaf => {
    const hinge = { x: w.start.x + dir.x * hingeOffset, y: w.start.y + dir.y * hingeOffset }
    const base = Math.atan2(dir.y * along, dir.x * along)
    const opened = base + (side * along * -openDeg * Math.PI) / 180
    return { hinge, width, height: o.height, closed: -base, open: -opened }
  }
  if (o.operation === 'double_swing') return [leaf(o.offset, 1, o.width / 2), leaf(o.offset + o.width, -1, o.width / 2)]
  return [o.hinge_at_end ? leaf(o.offset + o.width, -1, o.width) : leaf(o.offset, 1, o.width)]
}

/** Recorrido de cada hoja corrediza: de su posición cerrada a la abierta (sobre la otra hoja). */
export function slidingTracks(w: Pick<Wall, 'start' | 'end' | 'thickness'>, o: OpeningLike): { closed: StepBox; open: [number, number] }[] {
  const dir = wallDirection(w)
  return slidingLeaves(w, o).map((leaf, i) => {
    // la primera hoja corre hacia el final del vano y deja libre su mitad; la segunda queda fija
    const shift = i === 0 ? o.width * 0.42 : 0
    return { closed: leaf, open: [leaf.center[0] + dir.x * shift, leaf.center[2] + dir.y * shift] }
  })
}

/**
 * Descansos de escaleras en L o en U: entre el final de un tramo y el arranque del siguiente
 * (que empieza a la altura donde terminó el anterior) se pone una plataforma maciza.
 */
export function stairLandings(stairs: StairLike[]): { box: StepBox; top: number }[] {
  const flights = [...stairs].sort((a, b) => (a.base ?? 0) - (b.base ?? 0))
  const out: { box: StepBox; top: number }[] = []
  for (let i = 0; i + 1 < flights.length; i++) {
    const a = flights[i]!
    const b = flights[i + 1]!
    const top = (a.base ?? 0) + a.riser * a.steps
    if (Math.abs((b.base ?? 0) - top) > 0.05) continue
    const gap = Math.hypot(b.start.x - a.end.x, b.start.y - a.end.y)
    if (gap < 0.05 || gap > 2.5) continue
    // en el marco del tramo `a`: desde su final, hacia adelante un ancho de escalera, y lo que
    // ocupe el arranque de `b` (en U queda al lado; en L, adelante)
    const dir = (s: StairLike) => {
      const l = Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y) || 1
      return { x: (s.end.x - s.start.x) / l, y: (s.end.y - s.start.y) / l }
    }
    const da = dir(a)
    const db = dir(b)
    const pa = { x: -da.y, y: da.x }
    const pb = { x: -db.y, y: db.x }
    const pts: Point[] = []
    for (const k of [-1, 1]) {
      const ea = { x: a.end.x + pa.x * k * (a.width / 2), y: a.end.y + pa.y * k * (a.width / 2) }
      const sb = { x: b.start.x + pb.x * k * (b.width / 2), y: b.start.y + pb.y * k * (b.width / 2) }
      pts.push(ea, { x: ea.x + da.x * a.width, y: ea.y + da.y * a.width }, sb, { x: sb.x - db.x * b.width, y: sb.y - db.y * b.width })
    }
    const u = pts.map((p) => (p.x - a.end.x) * da.x + (p.y - a.end.y) * da.y)
    const v = pts.map((p) => (p.x - a.end.x) * pa.x + (p.y - a.end.y) * pa.y)
    // nunca se mete en el tramo `a` (sus peldaños terminan en u = 0)
    const u0 = Math.max(0, Math.min(...u))
    const u1 = Math.max(...u)
    const v0 = Math.min(...v)
    const v1 = Math.max(...v)
    const cu = (u0 + u1) / 2
    const cv = (v0 + v1) / 2
    out.push({
      box: {
        center: [a.end.x + da.x * cu + pa.x * cv, top / 2, a.end.y + da.y * cu + pa.y * cv],
        size: [u1 - u0, top, v1 - v0],
        rotationY: -Math.atan2(da.y, da.x),
      },
      top,
    })
  }
  return out
}

/** Rectángulo en planta que ocupan unos tramos de escalera (el hueco que deja la losa de arriba). */
export function stairWell(stairs: StairLike[], margin = 0.05): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (stairs.length === 0) return null
  const pts = stairs.flatMap((s) => {
    const len = Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y) || 1
    const nx = (-(s.end.y - s.start.y) / len) * (s.width / 2)
    const ny = ((s.end.x - s.start.x) / len) * (s.width / 2)
    return [s.start, s.end].flatMap((p) => [
      { x: p.x + nx, y: p.y + ny },
      { x: p.x - nx, y: p.y - ny },
    ])
  })
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return { minX: Math.min(...xs) - margin, minY: Math.min(...ys) - margin, maxX: Math.max(...xs) + margin, maxY: Math.max(...ys) + margin }
}

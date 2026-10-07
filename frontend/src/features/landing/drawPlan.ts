/**
 * Dibuja un BuildingModel como plano arquitectónico en tinta sobre un canvas 2D:
 * muros macizos con sus vanos, hojas de puerta con su arco, ventanas de tres
 * líneas, nombres y áreas de ambientes, y cotas generales.
 *
 * La landing lo usa dos veces: como textura de la "foto" en el hero 3D y como
 * lámina estática (antes/después, versión sin movimiento). Sin React ni three.
 */
import type { BuildingModel, Wall } from '@/api/types'
import { modelBounds, pointAlong, polygonArea, polygonCentroid, wallDirection, wallLength } from '@/domain/model'

export interface PlanStyle {
  paper: string | null
  ink: string
  /** trazo fino (arcos de puerta, cotas) */
  fine: string
  /** color de las cotas y anotaciones técnicas */
  accent: string
  labels: boolean
  dimensions: boolean
}

export const INK_STYLE: PlanStyle = {
  paper: '#f0efe9',
  ink: '#1c1f1d',
  fine: 'rgba(28,31,29,0.55)',
  accent: '#2f6b55',
  labels: true,
  dimensions: true,
}

export interface PlanFrame {
  /** píxeles por metro */
  scale: number
  /** origen del plano en píxeles (esquina superior izquierda del modelo) */
  ox: number
  oy: number
  width: number
  height: number
}

/** Encaja el modelo en un rectángulo de `width×height` px con `margin` px libres por lado. */
export function fitFrame(model: BuildingModel, width: number, height: number, margin: number): PlanFrame {
  const b = modelBounds(model)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  const scale = Math.min((width - 2 * margin) / w, (height - 2 * margin) / h)
  return {
    scale,
    ox: (width - w * scale) / 2 - b.minX * scale,
    oy: (height - h * scale) / 2 - b.minY * scale,
    width,
    height,
  }
}

/** Tramos macizos de un muro (en metros desde `start`), descontando los vanos. */
export function solidSpans(wall: Wall): [number, number][] {
  const len = wallLength(wall)
  const cuts = [...wall.openings].sort((a, b) => a.offset - b.offset)
  const spans: [number, number][] = []
  let at = 0
  for (const o of cuts) {
    if (o.offset > at) spans.push([at, Math.min(o.offset, len)])
    at = Math.max(at, o.offset + o.width)
  }
  if (at < len) spans.push([at, len])
  return spans.filter(([a, b]) => b - a > 1e-6)
}

export function drawPlan(ctx: CanvasRenderingContext2D, model: BuildingModel, f: PlanFrame, s: PlanStyle = INK_STYLE): void {
  const X = (x: number) => f.ox + x * f.scale
  const Y = (y: number) => f.oy + y * f.scale
  ctx.save()
  if (s.paper) {
    ctx.fillStyle = s.paper
    ctx.fillRect(0, 0, f.width, f.height)
  }
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'

  for (const lv of model.levels) {
    // muros: un rectángulo macizo por tramo (más un "nudo" cuadrado en cada extremo para cerrar esquinas)
    ctx.fillStyle = s.ink
    for (const wall of lv.walls) {
      const d = wallDirection(wall)
      const t = (wall.thickness * f.scale) / 2
      const n = { x: -d.y * t, y: d.x * t }
      for (const [a, b] of solidSpans(wall)) {
        const p = pointAlong(wall, a)
        const q = pointAlong(wall, b)
        ctx.beginPath()
        ctx.moveTo(X(p.x) + n.x, Y(p.y) + n.y)
        ctx.lineTo(X(q.x) + n.x, Y(q.y) + n.y)
        ctx.lineTo(X(q.x) - n.x, Y(q.y) - n.y)
        ctx.lineTo(X(p.x) - n.x, Y(p.y) - n.y)
        ctx.closePath()
        ctx.fill()
      }
      for (const end of [wall.start, wall.end]) ctx.fillRect(X(end.x) - t, Y(end.y) - t, 2 * t, 2 * t)
    }

    // aberturas
    for (const wall of lv.walls) {
      const d = wallDirection(wall)
      const t = (wall.thickness * f.scale) / 2
      const n = { x: -d.y, y: d.x }
      for (const o of wall.openings) {
        const p = pointAlong(wall, o.offset)
        const q = pointAlong(wall, o.offset + o.width)
        if (o.kind === 'window') {
          ctx.strokeStyle = s.ink
          ctx.lineWidth = Math.max(1, f.scale * 0.015)
          for (const k of [-1, 0, 1]) {
            ctx.beginPath()
            ctx.moveTo(X(p.x) + n.x * t * k, Y(p.y) + n.y * t * k)
            ctx.lineTo(X(q.x) + n.x * t * k, Y(q.y) + n.y * t * k)
            ctx.stroke()
          }
        } else {
          // hoja abierta a 90° desde la bisagra en `p`, con su arco de giro
          const r = o.width * f.scale
          const hx = X(p.x)
          const hy = Y(p.y)
          const leaf = { x: hx + n.x * r, y: hy + n.y * r }
          ctx.strokeStyle = s.ink
          ctx.lineWidth = Math.max(1.2, f.scale * 0.03)
          ctx.beginPath()
          ctx.moveTo(hx, hy)
          ctx.lineTo(leaf.x, leaf.y)
          ctx.stroke()
          ctx.strokeStyle = s.fine
          ctx.lineWidth = Math.max(0.75, f.scale * 0.01)
          const a0 = Math.atan2(d.y, d.x)
          const a1 = Math.atan2(n.y, n.x)
          ctx.beginPath()
          ctx.arc(hx, hy, r, a0, a1, angleCcw(a0, a1))
          ctx.stroke()
        }
      }
    }

    if (s.labels) {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const r of lv.rooms) {
        const c = polygonCentroid(r.polygon)
        const size = Math.max(9, f.scale * 0.2)
        ctx.fillStyle = s.ink
        ctx.font = `500 ${size}px "Geist", sans-serif`
        ctx.fillText(r.label, X(c.x), Y(c.y) - size * 0.6)
        ctx.fillStyle = s.fine
        ctx.font = `400 ${size * 0.8}px "Geist Mono", monospace`
        ctx.fillText(`${polygonArea(r.polygon).toFixed(1)} m²`, X(c.x), Y(c.y) + size * 0.7)
      }
    }
  }

  if (s.dimensions) {
    const b = modelBounds(model)
    const gap = Math.max(18, f.scale * 0.55)
    dimLine(ctx, X(b.minX), Y(b.minY) - gap, X(b.maxX), Y(b.minY) - gap, (b.maxX - b.minX).toFixed(2), s, f)
    dimLine(ctx, X(b.maxX) + gap, Y(b.minY), X(b.maxX) + gap, Y(b.maxY), (b.maxY - b.minY).toFixed(2), s, f)
  }
  ctx.restore()
}

/** El arco corto entre dos ángulos: true si hay que recorrerlo en sentido antihorario. */
function angleCcw(a0: number, a1: number): boolean {
  let delta = a1 - a0
  while (delta > Math.PI) delta -= 2 * Math.PI
  while (delta < -Math.PI) delta += 2 * Math.PI
  return delta < 0
}

/** Cota con marcas oblicuas de arquitectura (no flechas) y el valor centrado. */
function dimLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  text: string,
  s: PlanStyle,
  f: PlanFrame,
): void {
  const tick = Math.max(4, f.scale * 0.12)
  ctx.strokeStyle = s.accent
  ctx.fillStyle = s.accent
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  for (const [x, y] of [
    [x1, y1],
    [x2, y2],
  ] as const) {
    ctx.moveTo(x - tick, y + tick)
    ctx.lineTo(x + tick, y - tick)
  }
  ctx.stroke()
  const size = Math.max(9, f.scale * 0.2)
  ctx.font = `500 ${size * 0.9}px "Geist Mono", monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.save()
  ctx.translate((x1 + x2) / 2, (y1 + y2) / 2)
  if (Math.abs(x2 - x1) < Math.abs(y2 - y1)) ctx.rotate(-Math.PI / 2)
  ctx.fillText(text, 0, -3)
  ctx.restore()
}

/** Etiquetas del plano que no se encimen: el nombre del ambiente se ajusta a su ancho y las cotas que chocan se omiten. */

/** Ancho aproximado de un carácter respecto al tamaño de letra (Geist / Geist Mono). */
const CHAR = 0.6
const MIN_FONT_RATIO = 0.7

export interface RoomLabelFit {
  fontSize: number
  width: number
  height: number
  showArea: boolean
}

/** Alto de línea de los rótulos (igual al `lineHeight` del texto en el lienzo). */
export const LINE_HEIGHT = 1.2

/**
 * Cómo cabe el rótulo «Nombre / m²» de un ambiente de `roomW × roomH` (unidades del lienzo).
 * Achica la letra hasta un 70 % si hace falta; quita el área si no cabe en alto; `null` si ni así cabe.
 * Nunca corta una palabra a la mitad.
 */
export function fitRoomLabel(label: string, area: string, roomW: number, roomH: number, font: number): RoomLabelFit | null {
  const pad = font * 0.6
  const longest = Math.max(...label.split(/\s+/).map((w) => w.length), area.length)
  const available = roomW * 0.92 - pad
  const ideal = Math.max(label.length, area.length) * font * CHAR
  let fontSize = font
  if (longest * font * CHAR > available) fontSize = Math.max(font * MIN_FONT_RATIO, available / (longest * CHAR))
  if (longest * fontSize * CHAR > available + 0.5) return null
  const width = Math.min(ideal * (fontSize / font), available) + pad
  const lines = Math.ceil((label.length * fontSize * CHAR) / (width - pad))
  const lineH = fontSize * LINE_HEIGHT
  const showArea = (lines + 1) * lineH + pad <= roomH * 0.9
  if (!showArea && lines * lineH + pad > roomH * 0.9) return null
  return { fontSize, width, height: (lines + (showArea ? 1 : 0)) * lineH + pad, showArea }
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Caja (alineada a los ejes) de un texto de `w × h` centrado en (x, y) y girado `deg` grados. */
export function rotatedBox(x: number, y: number, w: number, h: number, deg: number): Box {
  const r = (deg * Math.PI) / 180
  const c = Math.abs(Math.cos(r))
  const s = Math.abs(Math.sin(r))
  const bw = w * c + h * s
  const bh = w * s + h * c
  return { x: x - bw / 2, y: y - bh / 2, w: bw, h: bh }
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * Coloca etiquetas en orden de prioridad (mayor primero) y omite las que chocan con una ya puesta
 * o con un obstáculo fijo (p. ej. los rótulos de los ambientes). Devuelve cuáles se muestran, en el orden original.
 */
export function placeLabels(items: { box: Box; priority: number }[], fixed: Box[] = []): boolean[] {
  const placed = [...fixed]
  const shown = items.map(() => false)
  const order = items.map((_, i) => i).sort((a, b) => items[b]!.priority - items[a]!.priority)
  for (const i of order) {
    const box = items[i]!.box
    if (placed.some((p) => overlaps(p, box))) continue
    placed.push(box)
    shown[i] = true
  }
  return shown
}

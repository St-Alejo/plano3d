/** Matemática de la vista del editor 2D (zoom con rueda y pellizco). Funciones puras. */

export interface View {
  scale: number
  x: number
  y: number
}

export interface Pt {
  x: number
  y: number
}

export const MIN_SCALE = 0.05
export const MAX_SCALE = 20

/** Zoom manteniendo fijo el punto de pantalla `at` (lo que está bajo el cursor/dedos no se mueve). */
export function zoomAt(view: View, at: Pt, factor: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor))
  const wx = (at.x - view.x) / view.scale
  const wy = (at.y - view.y) / view.scale
  return { scale, x: at.x - wx * scale, y: at.y - wy * scale }
}

export interface Pinch {
  distance: number
  center: Pt
}

export function pinchOf(a: Pt, b: Pt): Pinch {
  return { distance: Math.hypot(b.x - a.x, b.y - a.y), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
}

/** Un paso de pellizco: escala por la razón de distancias y desplaza con el centro de los dedos. */
export function pinchStep(view: View, prev: Pinch, next: Pinch): View {
  if (prev.distance < 1) return view
  const zoomed = zoomAt(view, prev.center, next.distance / prev.distance)
  return { ...zoomed, x: zoomed.x + next.center.x - prev.center.x, y: zoomed.y + next.center.y - prev.center.y }
}

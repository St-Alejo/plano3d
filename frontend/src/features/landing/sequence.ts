/**
 * Coreografía del hero: convierte el progreso del scroll (0..1) en el estado de
 * la escena. Es una función pura —sin three ni React— para poder probarla y para
 * que la versión sin movimiento muestre exactamente las mismas figuras.
 */

export interface Figure {
  n: string
  title: string
  text: string
}

/** Las cinco figuras siguen las etapas reales del pipeline del backend. */
export const FIGURES: Figure[] = [
  { n: '01', title: 'La foto', text: 'Una foto del plano, tomada con el celular: torcida, con sombra y en perspectiva.' },
  { n: '02', title: 'Rectificación', text: 'Se detectan las esquinas de la hoja y se corrige la perspectiva.' },
  { n: '03', title: 'Lectura', text: 'Muros, puertas, ventanas y cotas pasan de píxeles a vectores medidos en metros.' },
  { n: '04', title: 'Extrusión', text: 'Cada muro sube a su altura; los vanos quedan abiertos y los ambientes, con piso.' },
  { n: '05', title: 'Recorrido', text: 'Entras al apartamento a la altura de tus ojos y lo caminas como si estuvieras ahí.' },
]

export interface SceneState {
  /** índice de figura activa (0..4) */
  figure: number
  /** inclinación/giro de la "foto" (1 = foto torcida, 0 = rectificada) */
  skew: number
  /** opacidad de la lámina dibujada en el piso */
  paper: number
  /** trazos de muros dibujándose (0..1) */
  trace: number
  /** altura relativa de los muros (0..1) */
  extrude: number
  /** cámara: 0 = cenital, 1 = isométrica, 2 = a la altura de los ojos */
  camera: number
  /** marcas de esquina visibles (0..1) */
  corners: number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
/** Rampa suave de `a` a `b`. */
export const ramp = (p: number, a: number, b: number) => {
  const t = clamp01((p - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export function sceneAt(p: number): SceneState {
  const q = clamp01(p)
  return {
    figure: Math.min(FIGURES.length - 1, Math.floor(q * FIGURES.length)),
    skew: 1 - ramp(q, 0.12, 0.34),
    corners: ramp(q, 0.14, 0.22) * (1 - ramp(q, 0.36, 0.44)),
    trace: ramp(q, 0.42, 0.58),
    paper: 1 - 0.65 * ramp(q, 0.6, 0.74),
    extrude: ramp(q, 0.6, 0.78),
    camera: ramp(q, 0.58, 0.8) + ramp(q, 0.84, 0.98),
  }
}

/**
 * Coreografía del hero: convierte el progreso del scroll (0..1) en el estado de la escena.
 * Es una función pura —sin three ni React— para poder probarla y para que la versión sin
 * movimiento cuente exactamente las mismas etapas.
 *
 * Seis etapas, como una obra vista con la misma cámara: el plano flota como holograma sobre
 * el lote, la casa se construye (cimentación, muros, estructura) con la secuencia real de
 * obra, un barrido la termina y cae la noche con las luces de adentro encendidas.
 */

export interface Stage {
  id: 'plano' | 'cimentacion' | 'muros' | 'estructura' | 'acabados' | 'hogar'
  title: string
  text: string
}

export const STAGES: Stage[] = [
  { id: 'plano', title: 'Plano', text: 'Tu foto se vuelve un plano medido: muros, puertas, ventanas y cotas, en metros.' },
  { id: 'cimentacion', title: 'Cimentación', text: 'Zanja, acero y concreto. La casa empieza bajo tierra, como en la obra.' },
  { id: 'muros', title: 'Muros', text: 'El ladrillo sube hilada a hilada y deja abiertos los vanos de puertas y ventanas.' },
  { id: 'estructura', title: 'Estructura', text: 'Columnetas y vigas amarran los muros, con el acero que pide la NSR-10.' },
  { id: 'acabados', title: 'Acabados', text: 'Pisos, pañete, pintura y muebles: la casa como la vas a vivir.' },
  { id: 'hogar', title: 'Hogar', text: 'Tu casa terminada, antes de poner el primer ladrillo.' },
]

export interface SceneState {
  /** etapa activa (0..5) */
  stage: number
  /** opacidad del holograma del plano (0..1) */
  holo: number
  /** obra construida: 0 nada, 1 cimentación y placa, 2 muros, 3 estructura completa */
  build: number
  /** barrido de acabados: 0 obra gris, 1 casa terminada */
  sweep: number
  /** anochecer: el sol baja y se encienden las luces de adentro (0..1) */
  dusk: number
}

const N = STAGES.length
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Rampa suave (smoothstep) de `a` a `b`. */
export const ramp = (p: number, a: number, b: number) => {
  const t = clamp01((p - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Avance lineal dentro de la etapa `i`, dejando un respiro al entrar y al salir. */
const within = (p: number, i: number, pad = 0.012) => clamp01((p - i / N - pad) / (1 / N - 2 * pad))

export function sceneAt(p: number): SceneState {
  const q = clamp01(p)
  return {
    stage: Math.min(N - 1, Math.floor(q * N)),
    // el holograma queda como guía tenue mientras se hace la cimentación y se apaga con los muros
    holo: (1 - 0.7 * ramp(q, 0.12, 0.3)) * (1 - ramp(q, 0.34, 0.55)),
    build: within(q, 1) + within(q, 2) + within(q, 3),
    sweep: ramp(q, 4 / N, 5 / N - 0.01),
    // empieza durante el barrido y termina con la última pose: sin cambios de luz bruscos
    dusk: ramp(q, 0.72, 0.98),
  }
}

/** Pose de cámara: posición y punto al que mira. */
export interface Pose {
  pos: [number, number, number]
  look: [number, number, number]
}

/** Catmull-Rom uniforme entre b y c (a y d son los vecinos), en t ∈ [0, 1]. */
function catmull(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3)
}

/**
 * Recorrido de la cámara: una curva suave (Catmull-Rom) que pasa por las poses clave sin
 * detenerse en ellas, como un travelling. `p` se reparte entre los tramos según el `p` de cada
 * clave, así que cada etapa conserva su encuadre.
 */
export function cameraAt(p: number, keys: { p: number; pose: Pose }[]): Pose {
  const q = clamp01(p)
  const last = keys.length - 1
  const i = Math.min(last - 1, Math.max(0, keys.findIndex((_, j) => j + 1 <= last && q <= keys[j + 1]!.p)))
  const a = keys[Math.max(0, i - 1)]!.pose
  const b = keys[i]!.pose
  const c = keys[Math.min(last, i + 1)]!.pose
  const d = keys[Math.min(last, i + 2)]!.pose
  const span = keys[i + 1]!.p - keys[i]!.p
  const t = span > 0 ? clamp01((q - keys[i]!.p) / span) : 1
  const curve = (k: 'pos' | 'look') => b[k].map((_, n) => catmull(a[k][n]!, b[k][n]!, c[k][n]!, d[k][n]!, t)) as [number, number, number]
  return { pos: curve('pos'), look: curve('look') }
}

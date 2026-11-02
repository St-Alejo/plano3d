/**
 * Coreografía del hero: convierte el progreso del scroll (0..1) en el estado de la escena.
 * Es una función pura —sin three ni React— para poder probarla y para que la versión sin
 * movimiento cuente exactamente las mismas etapas.
 *
 * Seis etapas, como una obra vista con la misma cámara: el plano flota como holograma sobre
 * el lote, la casa se construye (cimentación, muros, estructura) con la secuencia real de
 * obra, un barrido la termina y la cámara entra a la sala.
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
  { id: 'hogar', title: 'Hogar', text: 'Entra a la altura de tus ojos y recórrela antes de poner un solo ladrillo.' },
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
  /** entrada a la casa: cámara a la altura de los ojos y luces de adentro (0..1) */
  interior: number
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
    holo: (1 - 0.75 * ramp(q, 0.15, 0.28)) * (1 - ramp(q, 0.4, 0.5)),
    build: within(q, 1) + within(q, 2) + within(q, 3),
    sweep: ramp(q, 4 / N + 0.01, 5 / N - 0.03),
    interior: ramp(q, 5 / N + 0.005, 0.985),
  }
}

/** Pose de cámara: posición y punto al que mira. */
export interface Pose {
  pos: [number, number, number]
  look: [number, number, number]
}

/**
 * Recorrido de la cámara por tramos: entre dos poses clave se interpola con una rampa suave,
 * así la cámara se detiene un instante en cada una (como los planos fijos del reel).
 */
export function cameraAt(p: number, keys: { p: number; pose: Pose }[]): Pose {
  const q = clamp01(p)
  const i = Math.max(0, keys.findIndex((_, j) => j + 1 < keys.length && q <= keys[j + 1]!.p))
  const a = keys[i]!
  const b = keys[Math.min(keys.length - 1, i + 1)]!
  const t = b.p > a.p ? ramp(q, a.p, b.p) : 1
  const mix = (u: [number, number, number], v: [number, number, number]) => u.map((x, k) => x + (v[k]! - x) * t) as [number, number, number]
  return { pos: mix(a.pose.pos, b.pose.pos), look: mix(a.pose.look, b.pose.look) }
}

/**
 * Hero de cine: la escena ocupa toda la pantalla y queda fijada mientras el scroll la lleva
 * de plano a hogar. Abajo a la izquierda, el titular (al empezar) o el nombre de la etapa,
 * que se encadenan con fundidos atados al scroll (sin cortes ni huecos); al pie, una barra
 * fina con las seis etapas. Sin WebGL o con movimiento reducido se muestra el plano y las
 * etapas como lista.
 */
import { motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'motion/react'
import { lazy, Suspense, useMemo, useRef, useState, type ReactNode } from 'react'

import type { BuildingModel } from '@/api/types'
import { prefersReducedMotion } from '@/features/viewer3d/motion'
import { EASE } from './ease'
import { PlanCanvas } from './PlanCanvas'
import { sampleApartment } from './sampleApartment'
import { sceneAt, STAGES } from './sequence'

const CinemaScene = lazy(() => import('./CinemaScene'))

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    return false
  }
}

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.9, ease: EASE, delay },
})

export function Headline({ children }: { children?: ReactNode }) {
  return (
    <div className="max-w-4xl">
      <motion.h1 {...rise(0.1)} id="hero-title" className="display t-display">
        Tu casa, desde el <em className="text-(--l-signal)">plano</em>.
      </motion.h1>
      <motion.p {...rise(0.25)} className="t-lead mt-6 max-w-md">
        Sube una foto de tu plano y mírala levantarse en 3D, ladrillo a ladrillo.
      </motion.p>
      {children && <motion.div {...rise(0.4)}>{children}</motion.div>}
    </div>
  )
}

const caption = 'Apartamento de ejemplo, 50 m² y cinco ambientes'

export function HeroStage({ actions }: { actions: ReactNode }) {
  const model = useMemo(() => sampleApartment(), [])
  const [animated] = useState(() => !prefersReducedMotion() && webglAvailable())
  if (animated) return <AnimatedHero model={model} actions={actions} />
  return <StaticHero model={model} actions={actions} />
}

function StaticHero({ model, actions }: { model: BuildingModel; actions: ReactNode }) {
  return (
    <section id="hero" aria-labelledby="hero-title" className="bg-(--l-night) pt-28 pb-20 sm:pt-36">
      <div className="frame grid items-end gap-12 lg:grid-cols-[7fr_5fr]">
        <Headline>{actions}</Headline>
        <figure className="aspect-[4/3] bg-(--l-sheet)">
          <PlanCanvas model={model} className="size-full" label="Plano de un apartamento de 50 m² útiles con sala-comedor, cocina, dos alcobas y baño" />
          <figcaption className="sr-only">{caption}</figcaption>
        </figure>
      </div>
      <ol aria-label="Etapas, del plano al hogar" className="frame mt-20 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {STAGES.map((s) => (
          <li key={s.id}>
            <p className="display text-4xl">{s.title}</p>
            <p className="mt-2 max-w-sm">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

const N = STAGES.length
/** duración de cada fundido y respiro alrededor del cambio, en fracción del recorrido */
const FADE = 0.022
const GAP = 0.004

/** Tramo de la barra: se llena mientras el scroll recorre su etapa. */
function StageBar({ progress, index, title, current }: { progress: MotionValue<number>; index: number; title: string; current: boolean }) {
  const fill = useTransform(progress, [index / N, (index + 1) / N], [0, 1], { clamp: true })
  return (
    <li aria-current={current ? 'step' : undefined} aria-label={`Etapa ${index + 1}: ${title}`} className="min-w-0">
      <span className="block h-0.5 overflow-hidden bg-white/20" aria-hidden>
        <motion.span className="block h-full origin-left bg-(--l-signal)" style={{ scaleX: fill }} />
      </span>
    </li>
  )
}

/**
 * Capa de una etapa: siempre montada, con opacidad y desplazamiento atados al scroll, así el
 * cambio sigue al dedo (sin animaciones sueltas que salten si el scroll va rápido).
 */
function StageLayer({ progress, index, children }: { progress: MotionValue<number>; index: number; children: ReactNode }) {
  const a = index / N
  const b = (index + 1) / N
  // tramos dentro de [0, 1] y crecientes (motion los pasa a animaciones nativas del navegador)
  // la que sale termina justo antes del cambio y la que entra empieza justo después: nunca
  // se ven dos títulos encimados
  const enter = index === 0 ? [] : [a + GAP, a + GAP + FADE]
  const leave = index === N - 1 ? [] : [b - GAP - FADE, b - GAP]
  const at = [...(index === 0 ? [0] : enter), ...(index === N - 1 ? [1] : leave)]
  const fade = [...(index === 0 ? [1] : [0, 1]), ...(index === N - 1 ? [1] : [1, 0])]
  const slide = [...(index === 0 ? [0] : [24, 0]), ...(index === N - 1 ? [0] : [0, -24])]
  const opacity = useTransform(progress, at, fade)
  const y = useTransform(progress, at, slide)
  const first = index === 0
  // apagada no ocupa la escena ni recibe clics
  const visibility = useTransform(opacity, (o) => (o < 0.01 ? 'hidden' : 'visible'))
  const pointerEvents = useTransform(opacity, (o) => (o < 0.5 ? 'none' : 'auto'))
  return (
    <motion.div className="[grid-area:1/1] self-end" style={{ opacity, y, visibility, pointerEvents }} aria-hidden={first ? undefined : true}>
      {children}
    </motion.div>
  )
}

/** La escena fijada: `useScroll` necesita que la sección exista, por eso vive en su propio componente. */
function AnimatedHero({ model, actions }: { model: BuildingModel; actions: ReactNode }) {
  const stage = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: stage, offset: ['start start', 'end end'] })
  const [current, setCurrent] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    const s = sceneAt(p).stage
    setCurrent((prev) => (prev === s ? prev : s))
  })
  const active = STAGES[current] ?? STAGES[0]!

  return (
    <section id="hero" ref={stage} aria-label="Del plano al modelo 3D, etapa por etapa" className="relative h-[420vh] bg-(--l-night)">
      <div className="sticky top-0 h-svh overflow-hidden">
        <div className="absolute inset-0">
          <Suspense fallback={null}>
            <CinemaScene model={model} progress={scrollYProgress} />
          </Suspense>
        </div>
        {/* velo neutro bajo el texto: la escena sigue siendo la protagonista */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-linear-to-t from-black/65 to-transparent" />

        <div className="frame relative flex h-full flex-col justify-end pb-8 sm:pb-10">
          <div className="grid">
            <StageLayer progress={scrollYProgress} index={0}>
              <Headline>{actions}</Headline>
            </StageLayer>
            {STAGES.slice(1).map((s, i) => (
              <StageLayer key={s.id} progress={scrollYProgress} index={i + 1}>
                <p className="display t-display">{s.title}</p>
                <p className="t-lead mt-5 max-w-md">{s.text}</p>
              </StageLayer>
            ))}
          </div>
          {/* para lectores de pantalla: la etapa actual, sin repetir las capas visuales */}
          <p className="sr-only" aria-live="polite">
            {current > 0 ? `${active.title}. ${active.text}` : ''}
          </p>

          <ol aria-label="Pasos de la secuencia" className="mt-10 grid grid-cols-6 gap-2 sm:mt-12 sm:gap-3">
            {STAGES.map((s, i) => (
              <StageBar key={s.id} progress={scrollYProgress} index={i} title={s.title} current={i === current} />
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

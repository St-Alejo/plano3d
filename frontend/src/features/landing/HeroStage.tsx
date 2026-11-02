/**
 * Hero de cine: la escena ocupa toda la pantalla y queda fijada mientras el scroll la lleva
 * de plano a hogar. Abajo a la izquierda, el titular (al empezar) o el nombre de la etapa;
 * al pie, la barra dorada con las seis etapas. Sin WebGL o con movimiento reducido se muestra
 * el plano y las etapas como lista.
 */
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'motion/react'
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
      <motion.h1 {...rise(0.1)} id="hero-title" className="display text-[clamp(3.3rem,8.4vw,8.6rem)] leading-[0.9]">
        Tu casa, desde el <em className="text-(--l-signal)">plano</em>.
      </motion.h1>
      <motion.p {...rise(0.25)} className="mt-8 max-w-xl text-lg leading-relaxed sm:text-xl">
        Toma una foto de tu plano: Plano 3D lo mide, lo levanta en 3D y te muestra cómo se construye, ladrillo a ladrillo.
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

/** Tramo de la barra: se llena mientras el scroll recorre su etapa. */
function StageBar({ progress, index, title, current }: { progress: MotionValue<number>; index: number; title: string; current: boolean }) {
  const n = STAGES.length
  const fill = useTransform(progress, [index / n, (index + 1) / n], [0, 1], { clamp: true })
  return (
    <li aria-current={current ? 'step' : undefined} aria-label={`Etapa ${index + 1}: ${title}`} className="min-w-0">
      <span className="block h-[3px] overflow-hidden bg-white/20" aria-hidden>
        <motion.span className="block h-full origin-left bg-(--l-signal)" style={{ scaleX: fill }} />
      </span>
      <span className={`mt-3 hidden truncate text-[15px] transition-colors duration-300 sm:block ${current ? 'text-(--l-ink)' : 'text-white/55'}`}>{title}</span>
    </li>
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
  // el titular se va con el primer tramo de scroll; no deja de existir (es el h1 de la página)
  const headOpacity = useTransform(scrollYProgress, [0.05, 0.13], [1, 0])
  const headY = useTransform(scrollYProgress, [0.05, 0.13], [0, -40])
  const headEvents = useTransform(headOpacity, (o) => (o < 0.2 ? 'none' : 'auto'))
  // ya apagado deja de ocupar la escena (ni tapa la etapa ni queda "fijado" seis pantallas)
  const headVisibility = useTransform(headOpacity, (o) => (o < 0.01 ? 'hidden' : 'visible'))
  const active = STAGES[current] ?? STAGES[0]!

  return (
    <section id="hero" ref={stage} aria-label="Del plano al modelo 3D, etapa por etapa" className="relative h-[640vh] bg-(--l-night)">
      <div className="sticky top-0 h-svh overflow-hidden">
        <div className="absolute inset-0">
          <Suspense fallback={null}>
            <CinemaScene model={model} progress={scrollYProgress} />
          </Suspense>
        </div>
        {/* velo neutro bajo el texto: la escena sigue siendo la protagonista */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[72%] bg-linear-to-t from-black/80 via-black/40 to-transparent" />

        <div className="frame relative flex h-full flex-col justify-end pb-6 sm:pb-9">
          <div className="grid">
            <motion.div className="[grid-area:1/1] self-end" style={{ opacity: headOpacity, y: headY, pointerEvents: headEvents, visibility: headVisibility }}>
              <Headline>{actions}</Headline>
            </motion.div>
            <div className="[grid-area:1/1] self-end" aria-live="polite">
              <AnimatePresence mode="wait" initial={false}>
                {current > 0 && (
                  <motion.div
                    key={active.id}
                    initial={{ opacity: 0, y: 28 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -18 }}
                    transition={{ duration: 0.5, ease: EASE }}
                  >
                    <p className="display text-[clamp(3.2rem,8vw,8rem)] leading-[0.9]">{active.title}</p>
                    <p className="mt-5 max-w-md text-lg leading-relaxed">{active.text}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="mt-10 flex items-end gap-6 sm:mt-14">
            <ol aria-label="Pasos de la secuencia" className="grid flex-1 grid-cols-6 gap-2 sm:gap-3">
              {STAGES.map((s, i) => (
                <StageBar key={s.id} progress={scrollYProgress} index={i} title={s.title} current={i === current} />
              ))}
            </ol>
          </div>
          <p className="mt-4 text-sm text-white/60">{caption}</p>
        </div>
      </div>
    </section>
  )
}

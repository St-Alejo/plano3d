/**
 * Hero con la secuencia fijada por scroll: a la izquierda el titular y el paso
 * actual, a la derecha el lienzo 3D. Sin WebGL o con movimiento reducido se
 * muestra el plano estático y los cinco pasos como lista.
 */
import clsx from 'clsx'
import { useMotionValueEvent, useScroll } from 'motion/react'
import { lazy, Suspense, useMemo, useRef, useState, type ReactNode } from 'react'

import type { BuildingModel } from '@/api/types'
import { prefersReducedMotion } from '@/features/viewer3d/motion'
import { PlanCanvas } from './PlanCanvas'
import { sampleApartment } from './sampleApartment'
import { FIGURES, sceneAt } from './sequence'

const HeroScene = lazy(() => import('./HeroScene'))

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    return false
  }
}

export function Headline({ children }: { children?: ReactNode }) {
  return (
    <div>
      <p className="inline-flex items-center gap-2 rounded-full bg-(--l-signal-soft) px-3 py-1 text-sm font-medium text-(--l-signal-ink)">
        Funciona con fotos, PDF y DXF
      </p>
      <h1 className="mt-5 text-[clamp(2.6rem,5vw,4.2rem)] leading-[1.02] font-semibold">
        Toma una foto de tu plano y recórrelo en 3D.
      </h1>
      <p className="mt-5 max-w-lg text-lg leading-relaxed text-(--l-graphite)">
        Plano 3D reconoce muros, puertas, ventanas y medidas, arma el modelo en segundos y te deja corregirlo antes de
        caminar por dentro.
      </p>
      {children}
    </div>
  )
}

const caption = 'Apartamento de ejemplo · 50 m² · 5 ambientes'

export function HeroStage({ actions }: { actions: ReactNode }) {
  const model = useMemo(() => sampleApartment(), [])
  const [animated] = useState(() => !prefersReducedMotion() && webglAvailable())
  const plan = (
    <PlanCanvas model={model} className="size-full" label="Plano de un apartamento de 50 m² útiles con sala-comedor, cocina, dos alcobas y baño" />
  )
  if (animated) return <AnimatedHero model={model} plan={plan} actions={actions} />
  return <StaticHero plan={plan} actions={actions} />
}

function StaticHero({ plan, actions }: { plan: ReactNode; actions: ReactNode }) {
  return (
    <section aria-labelledby="hero-title" className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[5fr_6fr]">
      <div id="hero-title">
        <Headline>{actions}</Headline>
      </div>
      <figure className="aspect-[4/3] overflow-hidden rounded-2xl bg-(--l-paper-2)">
        {plan}
        <figcaption className="sr-only">{caption}</figcaption>
      </figure>
      <ol className="grid gap-8 sm:grid-cols-5 lg:col-span-2">
        {FIGURES.map((f, i) => (
          <li key={f.n} className="border-t border-(--l-hair-strong) pt-4">
            <p className="text-sm text-(--l-graphite)">Paso {i + 1}</p>
            <p className="mt-1 font-semibold">{f.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-(--l-graphite)">{f.text}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** La secuencia fijada: `useScroll` necesita que la sección exista, por eso vive en su propio componente. */
function AnimatedHero({ model, plan, actions }: { model: BuildingModel; plan: ReactNode; actions: ReactNode }) {
  const stage = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: stage, offset: ['start start', 'end end'] })
  const [figure, setFigure] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    const f = sceneAt(p).figure
    setFigure((prev) => (prev === f ? prev : f))
  })
  const active = FIGURES[figure] ?? FIGURES[0]!
  return (
    <>
      {/* en pantallas angostas el titular va antes de la secuencia (en escritorio vive dentro de ella) */}
      <div className="px-4 pt-10 pb-4 sm:px-6 lg:hidden">
        <Headline>{actions}</Headline>
      </div>
      <section ref={stage} aria-label="Del plano al modelo 3D, paso a paso" className="relative h-[460vh]">
        <div className="sticky top-0 mx-auto flex h-svh max-w-6xl flex-col lg:grid lg:grid-cols-[5fr_6fr] lg:gap-12">
          {/* columna de texto */}
          <div className="order-2 flex flex-1 flex-col justify-between gap-6 px-4 pt-4 pb-6 sm:px-6 lg:order-1 lg:pt-20 lg:pb-10">
            <div className="hidden lg:block">
              <Headline>{actions}</Headline>
            </div>
            <div aria-live="polite">
              <ol className="flex gap-1.5" aria-label="Pasos de la secuencia">
                {FIGURES.map((f, i) => (
                  <li
                    key={f.n}
                    aria-current={i === figure ? 'step' : undefined}
                    aria-label={`Paso ${i + 1}: ${f.title}`}
                    className={clsx('h-1 flex-1 rounded-full transition-colors', i <= figure ? 'bg-(--l-signal)' : 'bg-(--l-hair)')}
                  />
                ))}
              </ol>
              <p className="mt-4 text-sm text-(--l-graphite)">
                Paso {figure + 1} de {FIGURES.length}
              </p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{active.title}</p>
              <p className="mt-2 max-w-md leading-relaxed text-(--l-graphite)">{active.text}</p>
            </div>
          </div>
          {/* lienzo 3D */}
          <div className="relative order-1 h-[56svh] shrink-0 px-4 pt-20 sm:px-6 lg:order-2 lg:h-auto lg:pt-20 lg:pb-10">
            <div className="relative size-full overflow-hidden rounded-2xl bg-(--l-paper-2) ring-1 ring-(--l-hair)">
              <Suspense fallback={plan}>
                <HeroScene model={model} progress={scrollYProgress} />
              </Suspense>
              <p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-(--l-paper)/90 px-3 py-1 text-xs font-medium text-(--l-graphite) shadow-sm">
                {caption}
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

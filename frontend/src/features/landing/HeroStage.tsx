/**
 * Hero con la secuencia fijada por scroll: a la izquierda el titular y la leyenda
 * de figuras, a la derecha el lienzo 3D enmarcado como una lámina (cotas, regla,
 * número de figura). Sin WebGL o con movimiento reducido se muestra la lámina
 * estática y las cinco figuras como lista.
 */
import clsx from 'clsx'
import { useMotionValueEvent, useScroll } from 'motion/react'
import { lazy, Suspense, useMemo, useRef, useState, type ReactNode } from 'react'

import type { BuildingModel } from '@/api/types'
import { prefersReducedMotion } from '@/features/viewer3d/motion'
import { PlanCanvas } from './PlanCanvas'
import { APT_D, APT_W, sampleApartment } from './sampleApartment'
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

/** Regla vertical: marca el avance del scroll como en un escalímetro. */
function ScrollRuler({ figure }: { figure: number }) {
  return (
    <div className="absolute inset-y-10 left-0 hidden w-6 flex-col justify-between xl:flex" aria-hidden>
      {FIGURES.map((f, i) => (
        <div key={f.n} className="flex items-center gap-1.5">
          <span className={clsx('h-px transition-all', i === figure ? 'w-5 bg-(--l-signal)' : 'w-2.5 bg-(--l-hair-strong)')} />
        </div>
      ))}
    </div>
  )
}

export function Headline({ children }: { children?: ReactNode }) {
  return (
    <div>
      <p className="font-mono text-xs tracking-[0.18em] text-(--l-graphite) uppercase">Foto · PDF · DXF → modelo 3D</p>
      <h1 className="serif mt-4 text-[clamp(3.2rem,7.4vw,8.4rem)] leading-[0.88]">
        De la hoja
        <br />
        al <em className="text-(--l-signal)">espacio</em>
        <br />
        que recorres.
      </h1>
      {children}
    </div>
  )
}

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
    <section aria-labelledby="hero-title" className="mx-auto grid max-w-[1400px] gap-10 px-4 py-12 sm:px-8 lg:grid-cols-[5fr_7fr]">
      <div id="hero-title">
        <Headline>{actions}</Headline>
      </div>
      <div className="aspect-[4/3] border border-(--l-hair-strong)">{plan}</div>
      <ol className="grid gap-6 sm:grid-cols-5 lg:col-span-2">
        {FIGURES.map((f) => (
          <li key={f.n} className="border-t border-(--l-hair-strong) pt-3">
            <p className="font-mono text-xs text-(--l-signal-ink)">Fig. {f.n}</p>
            <p className="mt-1 font-medium">{f.title}</p>
            <p className="mt-1 text-sm text-(--l-graphite)">{f.text}</p>
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
      <div className="px-4 pt-8 pb-4 sm:px-8 lg:hidden">
        <Headline>{actions}</Headline>
      </div>
    <section ref={stage} aria-label="Del plano al modelo 3D, paso a paso" className="relative h-[520vh]">
      <div className="sticky top-0 flex h-svh flex-col lg:grid lg:grid-cols-[5fr_7fr]">
        {/* columna de texto */}
        <div className="relative order-2 flex flex-1 flex-col justify-between gap-6 px-4 pt-4 pb-6 sm:px-8 lg:order-1 lg:py-10 xl:pl-14">
          <ScrollRuler figure={figure} />
          <div className="hidden lg:block">
            <Headline>{actions}</Headline>
          </div>
          <div aria-live="polite">
            <ol className="flex gap-3 font-mono text-xs" aria-label="Figuras de la secuencia">
              {FIGURES.map((f, i) => (
                <li
                  key={f.n}
                  aria-current={i === figure ? 'step' : undefined}
                  className={clsx('border-t pt-1.5 transition-colors', i === figure ? 'border-(--l-signal) text-(--l-ink)' : 'border-(--l-hair) text-(--l-graphite)')}
                >
                  {f.n}
                </li>
              ))}
            </ol>
            <p className="serif mt-3 text-3xl sm:text-4xl">
              <span className="font-mono text-sm text-(--l-signal-ink) align-middle">Fig. {active.n} — </span>
              {active.title}
            </p>
            <p className="mt-2 max-w-md text-(--l-graphite)">{active.text}</p>
          </div>
        </div>
        {/* lámina con el lienzo 3D */}
        <div className="relative order-1 h-[58svh] shrink-0 px-4 pt-16 sm:px-8 lg:order-2 lg:h-auto lg:py-10 lg:pr-10 lg:pl-0">
          <div className="relative size-full border border-(--l-hair-strong) bg-(--l-paper)">
            <Suspense fallback={plan}>
              <HeroScene model={model} progress={scrollYProgress} />
            </Suspense>
            {/* cota general sobre el marco */}
            <div className="pointer-events-none absolute -top-6 right-[12%] left-[12%] hidden items-center gap-2 sm:flex" aria-hidden>
              <span className="dim-h flex-1" />
              <span className="font-mono text-[11px] text-(--l-signal-ink)">{APT_W.toFixed(2)} × {APT_D.toFixed(2)} m</span>
              <span className="dim-h flex-1" />
            </div>
            <div className="pointer-events-none absolute bottom-3 left-3 hidden bg-(--l-paper) px-1.5 py-0.5 font-mono text-[11px] text-(--l-graphite) sm:block" aria-hidden>
              FIG. {active.n} · APTO. TIPO VIS · 50 m² ÚTILES
            </div>
            <div className="pointer-events-none absolute right-3 bottom-3 flex items-end gap-2 bg-(--l-paper) px-1.5 py-0.5 font-mono text-[11px] text-(--l-graphite)" aria-hidden>
              <span className="flex h-2 w-20 border border-(--l-ink)">
                <span className="w-1/2 bg-(--l-ink)" />
              </span>
              0 — 1 m
            </div>
          </div>
        </div>
      </div>
    </section>
    </>
  )
}

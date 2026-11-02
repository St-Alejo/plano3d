/**
 * Línea de tiempo de la obra: reproduce la secuencia constructiva sobre la escena 3D, con
 * anterior/siguiente y la tarjeta del paso ("Paso 7 de 15: muros del primer piso..."). Con
 * "Ver en pantalla" la misma línea de tiempo se muestra grande sobre el modelo: rótulo de la
 * etapa, el paso y una barra por etapas (cimentación, placas, muros, confinamiento).
 */
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Maximize2, Pause, Play, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type * as THREE from 'three'
import { stagesOf, type Stage, type Step } from '@/domain/structure/schedule'
import { prefersReducedMotion } from './motion'
import { stepTimeline } from './scene/timeline'
import type { StepTarget } from './viewerCommands'

/** Orden externa (del chat): ir a un paso o reproducir; `nonce` permite repetirla. */
export interface StepCommand {
  to: StepTarget
  nonce: number
}

/** Segundos que tarda cada paso al reproducir. */
const STEP_SECONDS = 2.2

const ICON_BUTTON = 'inline-flex size-9 items-center justify-center rounded-md border border-line-strong bg-canvas hover:border-accent disabled:opacity-40 pointer-coarse:size-11'

/** El paso k (desde 1) queda completo en t = k; t ∈ [0, n]. */
const indexAt = (t: number, n: number) => Math.min(n - 1, Math.max(0, Math.ceil(t) - 1))

function targetT(to: StepTarget, t: number, n: number): number {
  const i = indexAt(t, n)
  if (to === 'next') return Math.min(n, i + 2)
  if (to === 'prev') return Math.max(1, i)
  if (to === 'last') return n
  if (to === 'play') return t >= n ? 0 : t
  return Math.min(n, Math.max(1, Math.round(to)))
}

/** Estado de la línea de tiempo (un solo reloj para el panel y la vista a pantalla completa). */
function useSequence(steps: Step[], root: THREE.Object3D | null, command?: StepCommand | null) {
  // se arranca con el primer paso hecho
  const [t, setT] = useState(1)
  const [playing, setPlaying] = useState(false)
  const n = steps.length

  // órdenes del chat: se aplican al cambiar `command` (estado derivado durante el render)
  const [seen, setSeen] = useState(command ?? null)
  if (command !== seen) {
    setSeen(command ?? null)
    if (command && n > 0) {
      setT(targetT(command.to, t, n))
      setPlaying(command.to === 'play')
    }
  }

  useEffect(() => {
    if (root) stepTimeline(root, steps.map((s) => s.id), t)
  }, [root, steps, t])

  const latest = useRef(t)
  useEffect(() => {
    latest.current = t
  }, [t])
  useEffect(() => {
    if (!playing) return
    /** avanza a `next`; devuelve false cuando la obra terminó */
    const advance = (next: number) => {
      if (next >= n) {
        setT(n)
        setPlaying(false)
        return false
      }
      setT(next)
      return true
    }
    // sin animaciones (preferencia del sistema) se salta de paso en paso, uno por segundo
    if (prefersReducedMotion()) {
      const id = setInterval(() => advance(Math.floor(latest.current) + 1), 1000)
      return () => clearInterval(id)
    }
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      if (advance(latest.current + dt / STEP_SECONDS)) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, n])

  const current = indexAt(t, n)
  const go = (i: number) => {
    setPlaying(false)
    setT(Math.min(n, Math.max(1, i + 1)))
  }
  const toggle = () => {
    // al final, reproducir vuelve a empezar
    if (!playing && t >= n) setT(0)
    setPlaying((p) => !p)
  }
  return { t, n, current, step: steps[current], playing, go, toggle }
}

export function SequencePanel({
  steps,
  root,
  command,
  onCinemaChange,
}: {
  steps: Step[]
  root: THREE.Object3D | null
  command?: StepCommand | null
  /** la vista a pantalla completa se está reproduciendo: el visor gira la cámara despacio */
  onCinemaChange?: (rotating: boolean) => void
}) {
  const seq = useSequence(steps, root, command)
  const { t, n, current, step, playing, go, toggle } = seq
  const [cinema, setCinema] = useState(false)
  const stages = useMemo(() => stagesOf(steps), [steps])

  useEffect(() => {
    onCinemaChange?.(cinema && playing)
  }, [cinema, playing, onCinemaChange])
  useEffect(() => () => onCinemaChange?.(false), [onCinemaChange])

  if (!step) return null

  return (
    <section aria-label="Secuencia de obra" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button type="button" className={ICON_BUTTON} aria-label="Paso anterior" onClick={() => go(current - 1)} disabled={current === 0}>
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <button type="button" className={ICON_BUTTON} aria-label={playing ? 'Pausar' : 'Reproducir la obra'} onClick={toggle}>
          {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
        </button>
        <button type="button" className={ICON_BUTTON} aria-label="Paso siguiente" onClick={() => go(current + 1)} disabled={current >= n - 1 && t >= n}>
          <ChevronRight className="size-4" aria-hidden />
        </button>
        <input
          type="range"
          min={1}
          max={n}
          step={1}
          value={current + 1}
          onChange={(e) => go(Number(e.target.value) - 1)}
          aria-label="Paso de la obra"
          className="h-11 min-w-0 flex-1 accent-[var(--color-accent)]"
        />
      </div>
      <article aria-live="polite" aria-label="Paso actual" className="rounded-md border border-line bg-raised p-2 text-xs">
        <p className="text-subtle">
          Paso {current + 1} de {n}
        </p>
        <h3 className="text-sm font-medium">{step.title}</h3>
        <p className="mt-0.5 leading-snug">{step.detail}</p>
      </article>
      <button
        type="button"
        onClick={() => setCinema(true)}
        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-line-strong text-sm hover:border-accent pointer-coarse:h-11"
      >
        <Maximize2 className="size-4" aria-hidden /> Ver en pantalla
      </button>
      {cinema &&
        createPortal(
          <SequenceStage stages={stages} steps={steps} t={t} current={current} playing={playing} onToggle={toggle} onGo={go} onClose={() => setCinema(false)} />,
          document.body,
        )}
    </section>
  )
}

/** La secuencia en grande sobre el modelo, como en una presentación de obra. */
function SequenceStage({
  stages,
  steps,
  t,
  current,
  playing,
  onToggle,
  onGo,
  onClose,
}: {
  stages: Stage[]
  steps: Step[]
  t: number
  current: number
  playing: boolean
  onToggle: () => void
  onGo: (i: number) => void
  onClose: () => void
}) {
  const n = steps.length
  const step = steps[current]!
  const stage = stages.find((s) => current >= s.from && current < s.to) ?? stages[0]!
  const done = t >= n

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <section
      aria-label="Obra en pantalla"
      data-cinema
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-col gap-4 bg-linear-to-t from-black/70 via-black/35 to-transparent px-4 pt-24 pb-5 text-white sm:px-8 sm:pr-[22rem] sm:pb-8"
    >
      <div className="pointer-events-auto flex items-end justify-between gap-4">
        <div className="max-w-2xl" aria-live="polite">
          <p className="font-mono text-xs tracking-[0.18em] text-white/70 uppercase">
            Etapa {stages.indexOf(stage) + 1} de {stages.length} · Paso {current + 1} de {n}
          </p>
          <h2 className="mt-1 text-[clamp(2.25rem,5vw,3.75rem)] leading-[0.95] font-medium tracking-[-0.04em]">{done ? 'Obra gris terminada' : stage.label}</h2>
          <p className="mt-2 text-base font-medium">{step.title}</p>
          <p className="mt-0.5 max-w-xl text-sm leading-snug text-white/80">{step.detail}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            aria-label={playing ? 'Pausar' : 'Reproducir en pantalla'}
            onClick={onToggle}
            className="inline-flex size-11 items-center justify-center rounded-full bg-white text-black hover:brightness-90"
          >
            {playing ? <Pause className="size-5" aria-hidden /> : <Play className="size-5" aria-hidden />}
          </button>
          <button
            type="button"
            aria-label="Cerrar la vista en pantalla"
            onClick={onClose}
            className="inline-flex size-11 items-center justify-center rounded-full border border-white/40 hover:bg-white/15"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      {/* barra por etapas: cada tramo mide lo que sus pasos y se llena con el avance */}
      <ol aria-label="Etapas de la obra" className="pointer-events-auto flex gap-1.5">
        {stages.map((s, i) => {
          const fill = Math.min(1, Math.max(0, (t - s.from) / (s.to - s.from)))
          const isNow = s === stage
          return (
            <li key={`${s.id}-${i}`} className="flex min-w-0 flex-col gap-1.5" style={{ flexGrow: s.to - s.from, flexBasis: 0 }}>
              <button
                type="button"
                onClick={() => onGo(s.from)}
                aria-current={isNow ? 'step' : undefined}
                aria-label={`Ir a ${s.label}`}
                className="group flex h-6 items-center"
              >
                <span className="relative h-1 w-full overflow-hidden rounded-full bg-white/25 group-hover:bg-white/40">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${fill * 100}%` }} />
                </span>
              </button>
              <span className={clsx('truncate font-mono text-[11px] tracking-[0.1em] uppercase', isNow ? 'text-white' : 'text-white/60')}>{s.label}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

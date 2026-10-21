/**
 * Línea de tiempo de la obra: reproduce la secuencia constructiva sobre la escena 3D, con
 * anterior/siguiente y la tarjeta del paso ("Paso 7 de 15: muros del primer piso...").
 */
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type * as THREE from 'three'
import type { Step } from '@/domain/structure/schedule'
import { prefersReducedMotion } from './motion'
import { stepTimeline } from './scene/timeline'

/** Segundos que tarda cada paso al reproducir. */
const STEP_SECONDS = 2.2

const ICON_BUTTON = 'inline-flex size-9 items-center justify-center rounded-md border border-line-strong bg-canvas hover:border-accent disabled:opacity-40 pointer-coarse:size-11'

export function SequencePanel({ steps, root }: { steps: Step[]; root: THREE.Object3D | null }) {
  // t ∈ [0, n]: el paso i se construye entre i e i + 1; se arranca con el primero hecho
  const [t, setT] = useState(1)
  const [playing, setPlaying] = useState(false)
  const n = steps.length
  const current = Math.min(n - 1, Math.max(0, Math.ceil(t) - 1))
  const step = steps[current]

  useEffect(() => {
    if (root) stepTimeline(root, steps.map((s) => s.id), t)
  }, [root, steps, t])

  // al salir del modo, la escena se reconstruye: no hace falta restaurarla
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

  if (!step) return null
  const go = (i: number) => {
    setPlaying(false)
    setT(Math.min(n, Math.max(1, i + 1)))
  }

  return (
    <section aria-label="Secuencia de obra" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button type="button" className={ICON_BUTTON} aria-label="Paso anterior" onClick={() => go(current - 1)} disabled={current === 0}>
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label={playing ? 'Pausar' : 'Reproducir la obra'}
          onClick={() => {
            // al final, reproducir vuelve a empezar
            if (!playing && t >= n) setT(0)
            setPlaying((p) => !p)
          }}
        >
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
    </section>
  )
}

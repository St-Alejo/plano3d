/**
 * Cómo funciona: el video real de la app (el mismo tutorial que se ve dentro) y, debajo,
 * los tres momentos del proceso. El segundo nombra las etapas reales del análisis, las
 * mismas que se ven en la pantalla de procesamiento.
 */
import { Pause, Play } from 'lucide-react'
import { useInView, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { STAGES as PIPELINE } from '@/features/processing/progressState'
import { Reveal, Stagger, StaggerItem } from './reveal'
import { SectionHead } from './sections'

const stage = (key: string) => PIPELINE.find((s) => s.key === key)?.title.toLowerCase() ?? key

/** Las etapas que se nombran: las que el usuario reconoce en su plano. */
export const NAMED_STAGES = ['walls', 'scale', 'openings', 'rooms'].map(stage)

const STEPS = [
  { title: 'Toma la foto', text: 'Desde arriba, con la hoja completa. La perspectiva se corrige sola; también sirve un PDF o un DXF.' },
  {
    title: 'La app la lee',
    text: `En ${PIPELINE.length} etapas: ${NAMED_STAGES.slice(0, -1).join(', ')} y ${NAMED_STAGES.at(-1)}. Las ves avanzar en vivo.`,
  },
  { title: 'Corrige y recorre', text: 'Ajusta lo que haga falta con el ratón o escribiendo, y camina tu casa en 3D.' },
] as const

/** Video en bucle y sin sonido: corre solo cuando se ve y se puede pausar. */
function Loop() {
  const box = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const inView = useInView(box, { amount: 0.4 })
  const reduce = useReducedMotion()
  const [paused, setPaused] = useState(false)
  const playing = inView && !reduce && !paused

  useEffect(() => {
    const v = video.current
    if (!v) return
    // play() puede rechazarse (ahorro de datos, pestaña oculta): se queda en el póster
    if (playing) Promise.resolve(v.play()).catch(() => undefined)
    else v.pause()
  }, [playing])

  return (
    <div ref={box} className="relative aspect-video overflow-hidden bg-(--l-sheet)">
      <video
        ref={video}
        src="/tutoriales/crear.webm"
        poster="/landing/crear.jpg"
        muted
        loop
        playsInline
        preload="none"
        aria-label="Video: se dibuja un plano escribiendo y aparece en 3D al lado"
        className="size-full object-cover"
      />
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        aria-pressed={paused}
        className="absolute bottom-4 left-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-(--l-night) px-4 t-small transition-colors duration-300 hover:bg-(--l-night-2)"
      >
        {paused || reduce ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
        {paused || reduce ? 'Reproducir' : 'Pausar'}
      </button>
    </div>
  )
}

export function HowItWorks() {
  return (
    <section aria-labelledby="como-funciona" className="frame grid gap-12 py-20 sm:py-32">
      <SectionHead id="como-funciona" title="De la foto al modelo, en minutos." lead="Así se ve por dentro: el plano a la izquierda, la casa en 3D a la derecha." />
      <Reveal>
        <Loop />
      </Reveal>
      <Stagger as="ol" aria-label="Cómo funciona" className="grid gap-10 md:grid-cols-3 md:gap-12" gap={0.08}>
        {STEPS.map((s) => (
          <StaggerItem key={s.title} as="li" className="grid content-start gap-3">
            <h3 className="display t-h3">{s.title}</h3>
            <p className="max-w-sm">{s.text}</p>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  )
}

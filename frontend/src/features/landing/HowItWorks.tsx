/**
 * Cómo funciona: a la izquierda el título y los tres momentos del proceso (fijos mientras se
 * lee); a la derecha el video animado (30 s, de la foto a la casa en 3D, fuente en
 * design/video-landing), con la foto del plano debajo en parallax. El segundo paso nombra las
 * etapas reales del análisis, las mismas de la pantalla de proceso.
 */
import { Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useInView, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { Photo } from '@/components/Photo'
import { HOW_STEPS as STEPS } from './content'
import { Parallax } from './motion'
import { Reveal, Stagger, StaggerItem } from './reveal'
import { SectionHead } from './sections'

/**
 * Video en bucle: corre solo cuando se ve, empieza sin sonido (los navegadores no dejan
 * reproducir con sonido sin un gesto) y trae subtítulos; el botón de sonido lo reinicia con voz.
 */
function Loop() {
  const box = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const inView = useInView(box, { amount: 0.4 })
  const reduce = useReducedMotion()
  const [paused, setPaused] = useState(false)
  const [sound, setSound] = useState(false)
  const playing = inView && !reduce && !paused

  const toggleSound = () => {
    const v = video.current
    const next = !sound
    setSound(next)
    if (!v) return
    v.muted = !next
    // con voz se oye desde el comienzo; al activarlo también se quita la pausa
    if (next) {
      v.currentTime = 0
      setPaused(false)
      Promise.resolve(v.play()).catch(() => undefined)
    }
  }

  useEffect(() => {
    const v = video.current
    if (!v) return
    // play() puede rechazarse (ahorro de datos, pestaña oculta): se queda en el póster
    if (playing) Promise.resolve(v.play()).catch(() => undefined)
    else v.pause()
  }, [playing])

  return (
    <div ref={box} className="relative aspect-video overflow-hidden rounded-xl bg-(--l-sheet) shadow-[0_40px_80px_-44px_rgb(60_40_25/0.55)] ring-1 ring-(--l-rule)">
      <video
        ref={video}
        src="/tutoriales/como-funciona.mp4"
        poster="/landing/como-funciona.jpg"
        muted
        loop
        playsInline
        preload="none"
        aria-label="Video: la foto de un plano se endereza, se leen sus cotas, se trazan los muros y suben en 3D"
        className="size-full object-cover"
      />
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        aria-pressed={paused}
        className="absolute bottom-4 left-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-(--l-fg)/85 px-4 t-small text-(--l-bg) backdrop-blur transition-colors duration-300 hover:bg-(--l-fg)"
      >
        {paused || reduce ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
        {paused || reduce ? 'Reproducir' : 'Pausar'}
      </button>
      <button
        type="button"
        onClick={toggleSound}
        aria-pressed={sound}
        className="absolute right-4 bottom-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-(--l-fg)/85 px-4 t-small text-(--l-bg) backdrop-blur transition-colors duration-300 hover:bg-(--l-fg)"
      >
        {sound ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
        {sound ? 'Con sonido' : 'Activar sonido'}
      </button>
    </div>
  )
}

export function HowItWorks() {
  return (
    <section aria-labelledby="como-funciona" className="frame grid gap-16 py-24 sm:py-36 lg:grid-cols-[5fr_7fr] lg:gap-20">
      <div className="grid content-start gap-14 lg:sticky lg:top-28 lg:self-start">
        <SectionHead id="como-funciona" index={1} label="Cómo funciona" title="Así se ve por dentro." lead="En 30 segundos: de la foto del plano a la casa en 3D. Míralo con voz o sin sonido, con subtítulos." />
        <Stagger as="ol" aria-label="Cómo funciona" className="grid gap-8" gap={0.08}>
          {STEPS.map((s, i) => (
            <StaggerItem key={s.title} as="li" className="grid grid-cols-[3rem_1fr] gap-x-4 gap-y-2 border-t border-(--l-rule) pt-6">
              <span className="t-label row-span-2 pt-2 text-(--l-text-accent)" aria-hidden>
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="display t-h3">{s.title}</h3>
              <p className="max-w-sm text-(--l-dim)">{s.text}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
      <div className="grid content-start gap-8">
        <Reveal>
          <Loop />
        </Reveal>
        <div className="grid grid-cols-[7fr_5fr] items-end gap-6">
          <Parallax distance={50} className="aspect-[4/5] overflow-hidden rounded-xl">
            <Photo name="etapa-1-plano" sizes="(min-width: 1024px) 32vw, 58vw" className="size-full scale-115 object-cover" alt="El plano impreso sobre la mesa, con el celular al lado para tomarle la foto" />
          </Parallax>
          <Reveal delay={0.15}>
            <p className="display t-h3">Una foto desde arriba basta.</p>
            <p className="mt-3 t-small text-(--l-dim)">La perspectiva se corrige sola y las cotas escritas fijan la escala.</p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

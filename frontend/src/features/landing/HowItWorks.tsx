/**
 * Cómo funciona: a la izquierda el título y los tres momentos del proceso (fijos mientras se
 * lee); a la derecha el video animado (31 s, de la foto a la casa en 3D, con voz paisa de mujer
 * u hombre y música suave; fuente en design/video-landing), con la foto del plano debajo en parallax. El segundo paso nombra las
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

type Voice = 'off' | 'mujer' | 'hombre'

const VOICES: { id: Voice; label: string }[] = [
  { id: 'off', label: 'Sin sonido' },
  { id: 'mujer', label: 'Voz de mujer' },
  { id: 'hombre', label: 'Voz de hombre' },
]

/**
 * Video en bucle: corre solo cuando se ve y empieza sin sonido (los navegadores no dejan
 * reproducir con sonido sin un gesto), con subtítulos. Debajo se elige la voz paisa, mujer u
 * hombre: son dos archivos con la misma imagen, y al elegir una se oye desde el comienzo.
 */
function Loop() {
  const box = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const inView = useInView(box, { amount: 0.4 })
  const reduce = useReducedMotion()
  const [paused, setPaused] = useState(false)
  const [voice, setVoice] = useState<Voice>('off')
  const [file, setFile] = useState<'mujer' | 'hombre'>('mujer')
  // con una voz elegida el video corre aunque se prefiera menos movimiento: lo pidió quien mira
  const playing = (inView || voice !== 'off') && (!reduce || voice !== 'off') && !paused

  const choose = (next: Voice) => {
    const v = video.current
    setVoice(next)
    if (!v) return
    // `muted` de React no se actualiza en el DOM: se fija a mano
    v.muted = next === 'off'
    if (next === 'off') return
    setPaused(false)
    if (next === file) {
      v.currentTime = 0
      Promise.resolve(v.play()).catch(() => undefined)
    } else setFile(next) // el efecto de abajo la reproduce cuando cambie el archivo
  }

  useEffect(() => {
    const v = video.current
    if (!v) return
    // play() puede rechazarse (ahorro de datos, pestaña oculta): se queda en el póster
    if (playing) Promise.resolve(v.play()).catch(() => undefined)
    else v.pause()
  }, [playing, file])

  return (
    <div className="grid gap-3">
      <div ref={box} className="relative aspect-video overflow-hidden rounded-xl bg-(--l-sheet) shadow-[0_40px_80px_-44px_rgb(60_40_25/0.55)] ring-1 ring-(--l-rule)">
        <video
          ref={video}
          src={`/tutoriales/como-funciona-${file}.mp4`}
          poster="/landing/como-funciona.jpg"
          muted
          loop
          playsInline
          preload="none"
          aria-label="Video: la foto de un plano se endereza, se leen sus cotas, se trazan los muros y suben en 3D"
          className="size-full object-cover"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-(--l-fg) px-4 t-small text-(--l-bg) transition-colors duration-300 hover:bg-(--l-fg)/85"
        >
          {paused || (reduce && voice === 'off') ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
          {paused || (reduce && voice === 'off') ? 'Reproducir' : 'Pausar'}
        </button>
        <div role="radiogroup" aria-label="Sonido del video" className="inline-flex flex-wrap gap-1 rounded-full bg-(--l-card) p-1 ring-1 ring-(--l-rule)">
          {VOICES.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={voice === o.id}
              onClick={() => choose(o.id)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 t-small transition-colors duration-300 ${
                voice === o.id ? 'bg-(--l-fg) text-(--l-bg)' : 'text-(--l-dim) hover:text-(--l-fg)'
              }`}
            >
              {o.id === 'off' ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function HowItWorks() {
  return (
    <section aria-labelledby="como-funciona" className="frame grid gap-16 py-16 sm:py-24 lg:grid-cols-[5fr_7fr] lg:gap-20">
      <div className="grid content-start gap-14 lg:sticky lg:top-28 lg:self-start">
        <SectionHead id="como-funciona" index={1} label="Cómo funciona" title="Así se ve por dentro." lead="En 30 segundos: de la foto del plano a la casa en 3D. Míralo sin sonido, con subtítulos, o con voz paisa de mujer o de hombre." />
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

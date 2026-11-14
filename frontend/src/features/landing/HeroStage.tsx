/**
 * Hero: la misma casa, desde la misma cámara, construyéndose mientras bajas. Seis fotos (del
 * plano a la casa habitada) quedan fijas a pantalla completa y se encadenan con fundidos y un
 * acercamiento lento atados al scroll; abajo a la izquierda, el titular (al empezar) o el
 * nombre de la etapa, y al pie una barra con las seis etapas. Con movimiento reducido (o sin
 * `position: sticky`) se muestra la casa terminada y las etapas como lista.
 */
import { motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'motion/react'
import { useRef, useState, type ReactNode } from 'react'

import { Photo, type PhotoName } from '@/components/Photo'
import { prefersReducedMotion } from '@/features/viewer3d/motion'
import { EASE } from './ease'
import { sceneAt, STAGES } from './sequence'

const PHOTO_OF: Record<(typeof STAGES)[number]['id'], PhotoName> = {
  plano: 'etapa-1-plano',
  cimentacion: 'etapa-2-cimentacion',
  muros: 'etapa-3-muros',
  estructura: 'etapa-4-estructura',
  acabados: 'etapa-5-acabados',
  hogar: 'etapa-6-hogar',
}

function stickySupported(): boolean {
  return typeof window !== 'undefined' && typeof window.CSS?.supports === 'function' && window.CSS.supports('position', 'sticky')
}

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 28 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 1, ease: EASE, delay },
})

const pad = (n: number) => String(n).padStart(2, '0')

export function Headline({ children }: { children?: ReactNode }) {
  return (
    <div className="max-w-5xl">
      <motion.p {...rise(0.05)} className="t-label text-(--l-dim)">
        Plano 3D · de la foto al modelo
      </motion.p>
      <motion.h1 {...rise(0.12)} id="hero-title" className="t-hero mt-5">
        Tu casa, desde el <em className="text-(--l-text-accent)">plano</em>.
      </motion.h1>
      <motion.p {...rise(0.28)} className="t-lead mt-7 max-w-lg">
        Sube una foto de tu plano y mírala levantarse en 3D, ladrillo a ladrillo.
      </motion.p>
      {children && <motion.div {...rise(0.42)}>{children}</motion.div>}
    </div>
  )
}

export function HeroStage({ actions }: { actions: ReactNode }) {
  const [animated] = useState(() => !prefersReducedMotion() && stickySupported())
  if (animated) return <AnimatedHero actions={actions} />
  return <StaticHero actions={actions} />
}

function StaticHero({ actions }: { actions: ReactNode }) {
  return (
    <section id="hero" aria-labelledby="hero-title" className="l-dark relative overflow-hidden pt-32 pb-20 sm:pt-40">
      <Photo name="etapa-6-hogar" priority decorative className="absolute inset-0 size-full object-cover" />
      <div aria-hidden className="absolute inset-0 bg-linear-to-t from-black/85 via-black/45 to-black/30" />
      <div className="frame relative">
        <Headline>{actions}</Headline>
      </div>
      <ol aria-label="Etapas, del plano al hogar" className="frame relative mt-24 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {STAGES.map((s, i) => (
          <li key={s.id} className="grid content-start gap-3">
            <p className="display t-h3">{s.title}</p>
            <Photo name={PHOTO_OF[s.id]} sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw" className="aspect-[16/9] w-full rounded-md object-cover" />
            <p className="max-w-sm text-(--l-dim)">
              <span className="t-label mr-2 text-(--l-text-accent)">{pad(i + 1)}</span>
              {s.text}
            </p>
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
/** fundido entre fotos: más largo que el de los textos, para que la obra "crezca" */
const PHOTO_FADE = 0.06

/** Tramo de la barra: se llena mientras el scroll recorre su etapa. */
function StageBar({ progress, index, title, current }: { progress: MotionValue<number>; index: number; title: string; current: boolean }) {
  const fill = useTransform(progress, [index / N, (index + 1) / N], [0, 1], { clamp: true })
  return (
    <li aria-current={current ? 'step' : undefined} aria-label={`Etapa ${index + 1}: ${title}`} className="min-w-0">
      <span className="block h-0.5 overflow-hidden rounded-full bg-white/25" aria-hidden>
        <motion.span className="block h-full origin-left bg-(--l-accent)" style={{ scaleX: fill }} />
      </span>
      <span aria-hidden className={`t-label mt-3 hidden truncate transition-colors duration-500 sm:block ${current ? 'text-white' : 'text-white/55'}`}>
        {pad(index + 1)} {title}
      </span>
    </li>
  )
}

/**
 * Foto de una etapa: aparece sobre la anterior con un fundido y se acerca despacio mientras
 * dura su etapa (como un travelling corto). La primera ya está puesta al cargar.
 */
function StagePhoto({ progress, index }: { progress: MotionValue<number>; index: number }) {
  const a = index / N
  const b = (index + 1) / N
  const opacity = useTransform(progress, index === 0 ? [0, 1] : [a - PHOTO_FADE / 2, a + PHOTO_FADE / 2], index === 0 ? [1, 1] : [0, 1])
  const scale = useTransform(progress, [Math.max(0, a - PHOTO_FADE), Math.min(1, b + PHOTO_FADE)], [1.1, 1])
  const stage = STAGES[index]!
  return (
    <motion.div className="absolute inset-0 will-change-[opacity,transform]" style={{ opacity, scale }}>
      <Photo name={PHOTO_OF[stage.id]} priority={index === 0} decorative className="size-full object-cover" />
    </motion.div>
  )
}

/**
 * Capa de texto de una etapa: siempre montada, con opacidad y desplazamiento atados al scroll,
 * así el cambio sigue al dedo (sin animaciones sueltas que salten si el scroll va rápido).
 */
function StageLayer({ progress, index, children }: { progress: MotionValue<number>; index: number; children: ReactNode }) {
  const a = index / N
  const b = (index + 1) / N
  // tramos dentro de [0, 1] y crecientes (motion los pasa a animaciones nativas del navegador);
  // la que sale termina justo antes del cambio y la que entra empieza justo después
  const enter = index === 0 ? [] : [a + GAP, a + GAP + FADE]
  const leave = index === N - 1 ? [] : [b - GAP - FADE, b - GAP]
  const at = [...(index === 0 ? [0] : enter), ...(index === N - 1 ? [1] : leave)]
  const fade = [...(index === 0 ? [1] : [0, 1]), ...(index === N - 1 ? [1] : [1, 0])]
  const slide = [...(index === 0 ? [0] : [32, 0]), ...(index === N - 1 ? [0] : [0, -32])]
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
function AnimatedHero({ actions }: { actions: ReactNode }) {
  const stage = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: stage, offset: ['start start', 'end end'] })
  const [current, setCurrent] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    const s = sceneAt(p).stage
    setCurrent((prev) => (prev === s ? prev : s))
  })
  const active = STAGES[current] ?? STAGES[0]!

  return (
    <section id="hero" ref={stage} aria-label="Del plano al modelo 3D, etapa por etapa" className="l-dark relative h-[560vh]">
      <div className="sticky top-0 h-svh overflow-hidden">
        <div className="absolute inset-0 bg-(--l-bg)">
          {STAGES.map((s, i) => (
            <StagePhoto key={s.id} progress={scrollYProgress} index={i} />
          ))}
        </div>
        {/* velos: arriba para la cabecera y abajo para el texto; la foto sigue mandando */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-linear-to-b from-black/50 to-transparent" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%] bg-linear-to-t from-black/85 via-black/45 to-transparent" />

        <div className="frame relative flex h-full flex-col justify-end pb-8 sm:pb-10">
          <div className="grid">
            <StageLayer progress={scrollYProgress} index={0}>
              <Headline>{actions}</Headline>
            </StageLayer>
            {STAGES.slice(1).map((s, i) => (
              <StageLayer key={s.id} progress={scrollYProgress} index={i + 1}>
                <p className="t-label text-(--l-text-accent)">
                  Etapa {pad(i + 2)} / {pad(N)}
                </p>
                <p className="display t-hero mt-4">{s.title}</p>
                <p className="t-lead mt-6 max-w-md">{s.text}</p>
              </StageLayer>
            ))}
          </div>
          {/* para lectores de pantalla: la etapa actual, sin repetir las capas visuales */}
          <p className="sr-only" aria-live="polite">
            {current > 0 ? `${active.title}. ${active.text}` : ''}
          </p>

          <ol aria-label="Pasos de la secuencia" className="mt-10 grid grid-cols-6 gap-2 sm:mt-14 sm:gap-4">
            {STAGES.map((s, i) => (
              <StageBar key={s.id} progress={scrollYProgress} index={i} title={s.title} current={i === current} />
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

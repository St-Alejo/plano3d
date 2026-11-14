/**
 * Hero: la misma casa, desde la misma cámara, construyéndose mientras bajas. Trece fotos
 * alineadas píxel a píxel (del plano sobre la mesa a la casa encendida de noche) se funden
 * despacio una en otra, como un time-lapse de la obra, mientras la cámara se acerca sin parar.
 * El primer cuadro (el plano) se "atraviesa": crece y gira hasta volverse el lote replanteado.
 * Abajo a la izquierda va el titular (al empezar) o la etapa; arriba a la derecha, el cuadro
 * de obra que se está viendo; al pie, la barra con las seis etapas.
 * Con movimiento reducido (o sin `position: sticky`) se muestran las etapas como lista.
 */
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'motion/react'
import { useRef, useState, type ReactNode } from 'react'

import { Photo, type PhotoName } from '@/components/Photo'
import { prefersReducedMotion } from '@/features/viewer3d/motion'
import { EASE } from './ease'
import { CoverBox, Glow, Hotspot, type Spot } from './interactive'
import { useLight } from './useLight'
import { STAGES } from './sequence'

/** Cuadros del time-lapse: foto, etapa a la que pertenece, rótulo y peso (cuánto scroll dura). */
interface Frame {
  photo: PhotoName
  stage: number
  label: string
  weight: number
}

const FRAMES: Frame[] = [
  { photo: 'hero-01-etapa-1-plano', stage: 0, label: 'El plano', weight: 1.7 },
  { photo: 'hero-02-obra-01-replanteo', stage: 1, label: 'Replanteo', weight: 1 },
  { photo: 'hero-03-etapa-2-cimentacion', stage: 1, label: 'Zanjas y acero', weight: 1 },
  { photo: 'hero-04-obra-02-cimiento-fundido', stage: 1, label: 'Cimiento fundido', weight: 1 },
  { photo: 'hero-05-etapa-3-muros', stage: 2, label: 'Primeras hiladas', weight: 1 },
  { photo: 'hero-06-obra-03-losa', stage: 2, label: 'Losa del primer piso', weight: 1 },
  { photo: 'hero-07-obra-04-segundo-piso', stage: 3, label: 'Segundo piso', weight: 1 },
  { photo: 'hero-08-etapa-4-estructura', stage: 3, label: 'Obra gris', weight: 1 },
  { photo: 'hero-09-obra-05-panete', stage: 4, label: 'Pañete', weight: 1 },
  { photo: 'hero-10-obra-06-pintura', stage: 4, label: 'Pintura', weight: 1 },
  { photo: 'hero-11-etapa-5-acabados', stage: 4, label: 'Casa terminada', weight: 1 },
  { photo: 'hero-12-obra-07-hora-dorada', stage: 5, label: 'Atardecer', weight: 1 },
  { photo: 'hero-13-etapa-6-hogar', stage: 5, label: 'Las luces de adentro', weight: 1.4 },
]

const F = FRAMES.length
const TOTAL = FRAMES.reduce((s, f) => s + f.weight, 0)
/** inicio de cada cuadro en el recorrido (0..1); START[F] = 1 */
const START = FRAMES.reduce<number[]>((acc, f) => [...acc, acc[acc.length - 1]! + f.weight / TOTAL], [0])
/** inicio y fin de cada etapa: del primer cuadro de la etapa al primero de la siguiente */
const STAGE_SPAN = STAGES.map((_, s) => {
  const first = FRAMES.findIndex((f) => f.stage === s)
  const next = FRAMES.findIndex((f) => f.stage > s)
  return [START[first]!, next < 0 ? 1 : START[next]!] as const
})
/** fundido entre cuadros: largo (más de media foto) para que la obra "crezca" sin cortes */
const XFADE = 0.62 / TOTAL

function frameAt(p: number): number {
  for (let i = F - 1; i >= 0; i--) if (p >= START[i]!) return i
  return 0
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

/** última foto de cada etapa: la que mejor la resume en la versión quieta */
const STILL_OF = STAGES.map((_, s) => FRAMES.filter((f) => f.stage === s).at(-1)!.photo)

function StaticHero({ actions }: { actions: ReactNode }) {
  return (
    <section id="hero" aria-labelledby="hero-title" className="l-dark relative overflow-hidden pt-32 pb-20 sm:pt-40">
      <Photo name="hero-13-etapa-6-hogar" priority decorative className="absolute inset-0 size-full object-cover" />
      <div aria-hidden className="absolute inset-0 bg-linear-to-t from-black/85 via-black/45 to-black/30" />
      <div className="frame relative">
        <Headline>{actions}</Headline>
      </div>
      <ol aria-label="Etapas, del plano al hogar" className="frame relative mt-24 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {STAGES.map((s, i) => (
          <li key={s.id} className="grid content-start gap-3">
            <p className="display t-h3">{s.title}</p>
            <Photo name={STILL_OF[i]!} sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw" className="aspect-[16/9] w-full rounded-md object-cover" />
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
/** duración de cada fundido de texto y respiro alrededor del cambio, en fracción del recorrido */
const FADE = 0.02
const GAP = 0.004

/** Tramo de la barra: se llena mientras el scroll recorre su etapa. */
function StageBar({ progress, index, title, current }: { progress: MotionValue<number>; index: number; title: string; current: boolean }) {
  const [a, b] = STAGE_SPAN[index]!
  const fill = useTransform(progress, [a, b], [0, 1], { clamp: true })
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
 * Cuadro de la obra. Todos comparten encuadre, así que solo cambian de opacidad: el cuadro
 * nuevo aparece sobre el anterior con un fundido largo y la obra parece crecer. Un cuadro
 * tapado por completo deja de pintarse.
 */
function FramePhoto({ progress, index }: { progress: MotionValue<number>; index: number }) {
  const s = START[index]!
  const opacity = useTransform(progress, index === 0 ? [0, 1] : [s - XFADE / 2, s + XFADE / 2], index === 0 ? [1, 1] : [0, 1])
  // tapado del todo cuando el siguiente terminó de aparecer
  const covered = index < F - 1 ? START[index + 1]! + XFADE / 2 : 2
  const visibility = useTransform(progress, (p) => (p > covered + 0.002 || (index > 0 && p < s - XFADE / 2 - 0.002) ? 'hidden' : 'visible'))
  return (
    <motion.div className="absolute inset-0" style={{ opacity, visibility }}>
      <Photo name={FRAMES[index]!.photo} priority={index <= 1} decorative className="size-full object-cover object-[38%_50%] sm:object-center" />
    </motion.div>
  )
}

/**
 * El plano sobre la mesa: mientras aparece el lote, la cámara "entra" en el papel (crece, gira
 * un poco y se desenfoca), así el dibujo se vuelve el terreno replanteado.
 */
function PlanDive({ progress }: { progress: MotionValue<number> }) {
  const end = START[1]! + XFADE / 2
  const scale = useTransform(progress, [0, START[1]! - XFADE / 2, end], [1.04, 1.32, 2.1])
  const rotate = useTransform(progress, [START[1]! - XFADE / 2, end], [0, -7])
  const filter = useTransform(progress, [START[1]! - XFADE / 3, end], ['blur(0px)', 'blur(6px)'])
  const visibility = useTransform(progress, (p) => (p > end + 0.002 ? 'hidden' : 'visible'))
  const opacity = useTransform(progress, [START[1]! - XFADE / 4, end], [1, 0])
  return (
    <motion.div className="absolute inset-0 will-change-transform" style={{ scale, rotate, filter, visibility, zIndex: 2 }}>
      <motion.div className="size-full" style={{ opacity }}>
        <Photo name={FRAMES[0]!.photo} priority decorative className="size-full object-cover" />
      </motion.div>
    </motion.div>
  )
}

/**
 * Capa de texto de una etapa: siempre montada, con opacidad y desplazamiento atados al scroll,
 * así el cambio sigue al dedo (sin animaciones sueltas que salten si el scroll va rápido).
 */
function StageLayer({ progress, index, children }: { progress: MotionValue<number>; index: number; children: ReactNode }) {
  const [a, b] = STAGE_SPAN[index]!
  // tramos dentro de [0, 1] y crecientes; la que sale termina justo antes del cambio y la que
  // entra empieza justo después
  const enter = index === 0 ? [] : [a + GAP, a + GAP + FADE]
  const leave = index === N - 1 ? [] : [b - GAP - FADE, b - GAP]
  const at = [...(index === 0 ? [0] : enter), ...(index === N - 1 ? [1] : leave)]
  const fade = [...(index === 0 ? [1] : [0, 1]), ...(index === N - 1 ? [1] : [1, 0])]
  const slide = [...(index === 0 ? [0] : [40, 0]), ...(index === N - 1 ? [0] : [0, -40])]
  const opacity = useTransform(progress, at, fade)
  const y = useTransform(progress, at, slide)
  const first = index === 0
  const visibility = useTransform(opacity, (o) => (o < 0.01 ? 'hidden' : 'visible'))
  const pointerEvents = useTransform(opacity, (o) => (o < 0.5 ? 'none' : 'auto'))
  return (
    <motion.div className="[grid-area:1/1] self-end" style={{ opacity, y, visibility, pointerEvents }} aria-hidden={first ? undefined : true}>
      {children}
    </motion.div>
  )
}

/** La casa de noche: llega con las luces apagadas y se encienden al pasar el cursor, al tocar el
 * punto o, si nadie lo hace, solas al final del recorrido. */
const HOUSE: Spot = { x: 20, y: 4, w: 49, h: 82, dotX: 44, dotY: 38 }

function HouseLights({ progress, active }: { progress: MotionValue<number>; active: boolean }) {
  const s = START[F - 1]!
  const frameIn = useTransform(progress, [s - XFADE / 2, s + XFADE / 2], [0, 1])
  const light = useLight()
  const offOpacity = useTransform(() => frameIn.get() * light.off.get())
  const glow = useTransform(() => frameIn.get() * light.glow.get())
  const auto = useRef(false)
  const { setOn } = light
  useMotionValueEvent(progress, 'change', (p) => {
    if (p > 0.975 && !auto.current) {
      auto.current = true
      setOn(true)
    }
  })
  const [narrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches)
  return (
    <div className="absolute inset-0">
      <motion.div className="absolute inset-0" style={{ opacity: offOpacity }}>
        <Photo name="hero-13-hogar-apagado" decorative className="size-full object-cover object-[38%_50%] sm:object-center" />
      </motion.div>
      <CoverBox aspect={16 / 9} posX={narrow ? 0.38 : 0.5}>
        <Glow x={45} y={46} r={42} opacity={glow} />
        <Hotspot
          spot={HOUSE}
          active={active}
          pressed={light.on}
          label={light.on ? 'Apagar las luces de la casa' : 'Encender las luces de la casa'}
          hint={light.on ? 'Apagar' : 'Enciende las luces'}
          onHover={() => setOn(true)}
          onToggle={() => setOn((v) => !v)}
        />
      </CoverBox>
    </div>
  )
}

/** La escena fijada: `useScroll` necesita que la sección exista, por eso vive en su propio componente. */
function AnimatedHero({ actions }: { actions: ReactNode }) {
  const stage = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: stage, offset: ['start start', 'end end'] })
  const [frame, setFrame] = useState(0)
  // los cuadros se montan cuando están cerca (y se quedan): la página no baja 13 fotos de golpe
  const [reach, setReach] = useState(2)
  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    const f = frameAt(p)
    setFrame((prev) => (prev === f ? prev : f))
    setReach((r) => Math.max(r, f + 3))
  })
  const current = FRAMES[frame]!.stage
  const active = STAGES[current] ?? STAGES[0]!

  // la cámara avanza hacia la casa durante todo el recorrido (después del plano)
  // anclada arriba: la casa crece hacia el cielo y el acercamiento nunca le corta el techo
  const dolly = useTransform(scrollYProgress, [START[1]!, 1], [1.0, 1.1])
  const drift = useTransform(scrollYProgress, [START[1]!, 1], ['0%', '1.5%'])
  // al final la escena baja a oscuro para enlazar con el recorrido, que empieza en la noche
  const dusk = useTransform(scrollYProgress, [0.965, 1], [0, 0.78])
  // la noche: el velo de abajo se hace más profundo al final
  const veil = useTransform(scrollYProgress, [START[F - 2]!, 1], [0.82, 0.92])

  return (
    <section id="hero" ref={stage} aria-label="Del plano al modelo 3D, etapa por etapa" className="l-dark relative h-[960vh]">
      <div className="sticky top-0 h-svh overflow-hidden">
        <div className="absolute inset-0 bg-(--l-bg)">
          <motion.div className="absolute inset-0 origin-[46%_18%] will-change-transform" style={{ scale: dolly, y: drift }}>
            {/* en el celular la obra sube: lo que se construye queda encima del texto y no debajo */}
            <div className="absolute inset-0 max-sm:top-[-2%] max-sm:bottom-[26%]">
              {FRAMES.map((f, i) => (i === 0 || i > reach ? null : <FramePhoto key={f.photo} progress={scrollYProgress} index={i} />))}
              {reach >= F - 1 && <HouseLights progress={scrollYProgress} active={frame === F - 1} />}
            </div>
          </motion.div>
          <PlanDive progress={scrollYProgress} />
        </div>
        {/* velos: arriba para la cabecera, abajo para el texto y una viñeta suave para dar fondo */}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[3] bg-[radial-gradient(ellipse_at_50%_45%,transparent_55%,rgb(0_0_0/0.35))]" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-[3] h-40 bg-linear-to-b from-black/55 to-transparent" />
        <motion.div aria-hidden style={{ opacity: veil }} className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] h-[72%] bg-linear-to-t from-black via-black/50 to-transparent" />

        <motion.div aria-hidden style={{ opacity: dusk }} className="pointer-events-none absolute inset-0 z-[3] bg-black" />

        {/* cuadro de obra que se está viendo: cambia con cada foto, como el rótulo de una lámina */}
        <div className="frame pointer-events-none absolute inset-x-0 top-24 z-[4] flex justify-end sm:top-28" aria-hidden>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.p
              key={frame}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.45, ease: EASE }}
              className="t-label flex items-center gap-3 text-white/85"
            >
              <span className="text-(--l-text-accent)">{pad(frame + 1)}</span>
              <span className="h-px w-8 bg-white/40" />
              <span>{FRAMES[frame]!.label}</span>
              <span className="text-white/45">/ {pad(F)}</span>
            </motion.p>
          </AnimatePresence>
        </div>

        <div className="frame pointer-events-none relative z-[4] flex h-full flex-col justify-end pb-8 sm:pb-10">
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

/**
 * Recorrido por dentro: sigue al hero (la casa encendida de noche). La cámara se acerca a la
 * puerta entreabierta hasta cruzarla y, ya adentro, pasa de un espacio a otro con fundidos
 * largos y un paneo lento que cambia de lado en cada cuarto, como si se caminara la casa.
 * A la derecha, la lista de espacios marca dónde se está. Con movimiento reducido (o sin
 * `position: sticky`) los espacios se muestran como una galería.
 */
import { motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'motion/react'
import { useRef, useState } from 'react'

import { Photo, type PhotoName } from '@/components/Photo'
import { prefersReducedMotion } from '@/features/viewer3d/motion'

interface Room {
  photo: PhotoName
  floor: string
  name: string
  text: string
  weight: number
}

const DOOR: PhotoName = 'interior-umbral'

const ROOMS: Room[] = [
  { photo: 'interior-entrada', floor: 'Piso 1', name: 'Entrada', text: 'El hall y la escalera: la casa empieza en la puerta, no en la fachada.', weight: 1 },
  { photo: 'interior-comedor', floor: 'Piso 1', name: 'Sala y comedor', text: 'Doble altura y un ventanal al patio, con las medidas de tu plano.', weight: 1.1 },
  { photo: 'interior-cocina', floor: 'Piso 1', name: 'Cocina', text: 'Cada espacio a escala real: ves si cabe antes de construirlo.', weight: 1 },
  { photo: 'interior-alcoba', floor: 'Piso 3', name: 'Alcoba principal', text: 'Subes por la escalera, piso por piso, como en la casa de verdad.', weight: 1 },
  { photo: 'interior-terraza', floor: 'Azotea', name: 'Terraza', text: 'Y arriba, la terraza. Todo esto, antes de poner un ladrillo.', weight: 1.3 },
]

/** la puerta ocupa el primer tramo; luego cada espacio según su peso */
const DOOR_WEIGHT = 1.5
const TOTAL = DOOR_WEIGHT + ROOMS.reduce((s, r) => s + r.weight, 0)
const START = ROOMS.reduce<number[]>((acc, r) => [...acc, acc[acc.length - 1]! + r.weight / TOTAL], [DOOR_WEIGHT / TOTAL])
const XFADE = 0.5 / TOTAL

function roomAt(p: number): number {
  for (let i = ROOMS.length - 1; i >= 0; i--) if (p >= START[i]!) return i
  return -1
}

function stickySupported(): boolean {
  return typeof window !== 'undefined' && typeof window.CSS?.supports === 'function' && window.CSS.supports('position', 'sticky')
}

const TITLE = 'Y por dentro, ya es tuya.'
const LEAD = 'Así puede verse terminada. En la app la recorres a pie, piso por piso.'

export function Walkthrough() {
  const [animated] = useState(() => !prefersReducedMotion() && stickySupported())
  return animated ? <AnimatedWalk /> : <StaticWalk />
}

function StaticWalk() {
  return (
    <section id="recorrido" aria-labelledby="recorrido-title" className="l-dark py-24 sm:py-32">
      <div className="frame">
        <p className="t-label text-(--l-text-accent)">Recorrido</p>
        <h2 id="recorrido-title" className="t-h2 mt-5 max-w-3xl">
          {TITLE}
        </h2>
        <p className="t-lead mt-6 max-w-xl text-(--l-dim)">{LEAD}</p>
        <ul aria-label="Espacios del recorrido" className="mt-14 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {ROOMS.map((r) => (
            <li key={r.photo} className="grid content-start gap-4">
              <Photo name={r.photo} sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw" className="aspect-[16/10] w-full rounded-md object-cover" />
              <p className="t-label text-(--l-dim)">{r.floor}</p>
              <p className="display t-h3">{r.name}</p>
              <p className="max-w-sm text-(--l-dim)">{r.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** La puerta: la cámara se acerca a la rendija de luz hasta pasar por ella. */
function Door({ progress }: { progress: MotionValue<number> }) {
  const end = START[0]! + XFADE / 2
  const scale = useTransform(progress, [0, START[0]! - XFADE, end], [1.0, 1.55, 3.2])
  const opacity = useTransform(progress, [START[0]! - XFADE / 3, end], [1, 0])
  const visibility = useTransform(progress, (p) => (p > end + 0.002 ? 'hidden' : 'visible'))
  // llega desde la oscuridad con la que termina el hero
  const dark = useTransform(progress, [0, START[0]! * 0.35], [0.7, 0])
  return (
    <motion.div className="absolute inset-0 z-[2] origin-[52%_50%] will-change-transform" style={{ scale, opacity, visibility }}>
      <Photo name={DOOR} decorative sizes="100vw" className="size-full object-cover" />
      <motion.div aria-hidden className="absolute inset-0 bg-black" style={{ opacity: dark }} />
    </motion.div>
  )
}

/**
 * Un espacio. El primero llega todavía "en movimiento" desde la puerta, con un fundido; los
 * demás entran con un barrido de borde suave desde el lado hacia el que camina la cámara (sin
 * la doble exposición turbia de un fundido entre cuartos distintos). Mientras dura, la cámara
 * se desliza hacia un lado (alternando) y se acerca apenas.
 */
function RoomPhoto({ progress, index }: { progress: MotionValue<number>; index: number }) {
  const s = START[index]!
  const e = START[index + 1]!
  const dir = index % 2 === 0 ? 1 : -1
  const from = s - XFADE / 2
  const to = Math.min(1, e + XFADE / 2)
  const first = index === 0
  const opacity = useTransform(progress, [from, s + XFADE / 2], first ? [0, 1] : [1, 1])
  // borde del barrido: lo visible crece de -20 % (nada) a 120 % (todo), con 20 puntos de degradado
  const edge = useTransform(progress, [from, s + XFADE / 2], [-20, 120])
  const side = dir > 0 ? 'to left' : 'to right'
  const mask = useTransform(edge, (v) => (first || v >= 120 ? 'none' : `linear-gradient(${side}, #000 ${v}%, transparent ${v + 20}%)`))
  const scale = useTransform(progress, [from, to], [first ? 1.32 : 1.1, 1.02])
  const x = useTransform(progress, [from, to], [`${2.5 * dir}%`, `${-2.5 * dir}%`])
  const visibility = useTransform(progress, (p) => (p < from - 0.002 || (index < ROOMS.length - 1 && p > START[index + 1]! + XFADE / 2 + 0.002) ? 'hidden' : 'visible'))
  return (
    <motion.div className="absolute inset-0" style={{ opacity, visibility, maskImage: mask, WebkitMaskImage: mask }}>
      <motion.div className="size-full will-change-transform" style={{ scale, x }}>
        <Photo name={ROOMS[index]!.photo} decorative sizes="100vw" className="size-full object-cover" />
      </motion.div>
    </motion.div>
  )
}

/** Texto de un espacio, atado al scroll: entra al llegar al cuarto y sale antes del siguiente. */
function RoomCaption({ progress, index }: { progress: MotionValue<number>; index: number }) {
  const s = START[index]!
  const e = START[index + 1]!
  const last = index === ROOMS.length - 1
  const at = last ? [s, s + 0.03, 1] : [s, s + 0.03, e - 0.03, e - 0.005]
  const opacity = useTransform(progress, at, last ? [0, 1, 1] : [0, 1, 1, 0])
  const y = useTransform(progress, at, last ? [36, 0, 0] : [36, 0, 0, -24])
  const r = ROOMS[index]!
  return (
    <motion.div aria-hidden className="[grid-area:1/1] self-end" style={{ opacity, y }}>
      <p className="t-label text-(--l-text-accent)">
        {r.floor} · {String(index + 1).padStart(2, '0')} / {String(ROOMS.length).padStart(2, '0')}
      </p>
      <p className="display t-display mt-4">{r.name}</p>
      <p className="t-lead mt-5 max-w-md">{r.text}</p>
    </motion.div>
  )
}

function AnimatedWalk() {
  const box = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: box, offset: ['start start', 'end end'] })
  const [room, setRoom] = useState(-1)
  const [near, setNear] = useState(false)
  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    const r = roomAt(p)
    setRoom((prev) => (prev === r ? prev : r))
    if (p > 0) setNear(true)
  })
  // el título acompaña la puerta y se va al cruzarla
  const introOpacity = useTransform(scrollYProgress, [START[0]! - XFADE * 1.2, START[0]! - XFADE * 0.4], [1, 0])
  const introY = useTransform(scrollYProgress, [0, START[0]!], [0, -60])

  return (
    <section id="recorrido" ref={box} aria-labelledby="recorrido-title" className="l-dark relative h-[620vh]">
      <div className="sticky top-0 h-svh overflow-hidden">
        <div className="absolute inset-0 bg-(--l-bg)">
          {near && ROOMS.map((r, i) => <RoomPhoto key={r.photo} progress={scrollYProgress} index={i} />)}
          <Door progress={scrollYProgress} />
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[3] bg-[radial-gradient(ellipse_at_50%_45%,transparent_50%,rgb(0_0_0/0.4))]" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] h-[65%] bg-linear-to-t from-black/90 via-black/45 to-transparent" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-[3] h-40 bg-linear-to-b from-black/55 to-transparent" />

        <div className="frame relative z-[4] grid h-full grid-cols-1 items-end gap-10 pb-10 sm:pb-14 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="grid">
            <motion.div className="[grid-area:1/1] self-end" style={{ opacity: introOpacity, y: introY }}>
              <p className="t-label text-(--l-text-accent)">Recorrido</p>
              <h2 id="recorrido-title" className="t-display mt-5 max-w-4xl">
                {TITLE}
              </h2>
              <p className="t-lead mt-6 max-w-lg text-white/85">{LEAD}</p>
            </motion.div>
            {ROOMS.map((r, i) => (
              <RoomCaption key={r.photo} progress={scrollYProgress} index={i} />
            ))}
          </div>
          <ol aria-label="Espacios del recorrido" className="hidden gap-3 self-end border-l border-white/20 pl-5 lg:grid">
            {ROOMS.map((r, i) => (
              <li key={r.photo} aria-current={i === room ? 'location' : undefined} className={`t-small flex items-baseline gap-3 transition-colors duration-500 ${i === room ? 'text-white' : 'text-white/50'}`}>
                <span className={`t-label transition-colors duration-500 ${i === room ? 'text-(--l-text-accent)' : ''}`}>{r.floor}</span>
                <span>{r.name}</span>
              </li>
            ))}
          </ol>
          <p className="sr-only" aria-live="polite">
            {room >= 0 ? `${ROOMS[room]!.name}. ${ROOMS[room]!.text}` : ''}
          </p>
        </div>
      </div>
    </section>
  )
}

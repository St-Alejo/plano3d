/**
 * Efectos de la landing inspirados en sitios de estudio (titular letra a letra,
 * texto que se ilumina con el scroll, marquesina, odómetro y cortina), en versión
 * sobria. Todos se apagan o quedan en su estado final con movimiento reducido.
 */
import {
  motion,
  useAnimationFrame,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
  type MotionValue,
} from 'motion/react'
import { useRef, type ReactNode } from 'react'
import clsx from 'clsx'

import { EASE } from './ease'

/** Titular que aparece letra a letra, cada una enfocándose desde un desenfoque. */
export function SplitChars({ text, delay = 0, className }: { text: string; delay?: number; className?: string }) {
  let n = 0
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.split(' ').map((word, wi, words) => (
          // cada palabra es un bloque que no se parte entre líneas
          <span key={wi} className="inline-block whitespace-nowrap">
            {[...word].map((ch) => {
              const i = n++
              return (
                <motion.span
                  key={i}
                  className="inline-block"
                  initial={{ opacity: 0, filter: 'blur(12px)', y: '0.25em' }}
                  animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
                  transition={{ duration: 0.9, ease: EASE, delay: delay + i * 0.028 }}
                >
                  {ch}
                </motion.span>
              )
            })}
            {wi < words.length - 1 && <span className="inline-block">&nbsp;</span>}
          </span>
        ))}
      </span>
    </span>
  )
}

function ScrollWord({ word, progress, range }: { word: string; progress: MotionValue<number>; range: [number, number] }) {
  const opacity = useTransform(progress, range, [0.16, 1])
  return (
    <motion.span className="inline-block" style={{ opacity }}>
      {word}&nbsp;
    </motion.span>
  )
}

/** Párrafo grande cuyas palabras pasan de tenues a plenas a medida que se recorre con el scroll. */
export function ScrollText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.45'] })
  const words = text.split(' ')
  return (
    <p ref={ref} className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {words.map((w, i) => (
          <ScrollWord key={i} word={w} progress={scrollYProgress} range={[i / words.length, (i + 1) / words.length]} />
        ))}
      </span>
    </p>
  )
}

/**
 * Cinta de palabras que se desplaza sin fin. La velocidad del scroll la acelera
 * y su sentido la invierte, como en las marquesinas de estudio.
 */
export function Marquee({ items, baseSpeed = 3 }: { items: string[]; baseSpeed?: number }) {
  const reduce = useReducedMotion()
  const x = useMotionValue(0)
  const { scrollY } = useScroll()
  const velocity = useSpring(useVelocity(scrollY), { damping: 50, stiffness: 400 })
  const boost = useTransform(velocity, [-1000, 0, 1000], [-4, 0, 4], { clamp: false })
  const dir = useRef(1)
  const track = useRef<HTMLDivElement>(null)

  useAnimationFrame((_, delta) => {
    if (reduce || !track.current) return
    const b = boost.get()
    if (b < 0) dir.current = -1
    else if (b > 0) dir.current = 1
    const half = track.current.scrollWidth / 2
    let next = x.get() - dir.current * baseSpeed * (delta / 1000) * 20 * (1 + Math.abs(b))
    // el contenido está duplicado: al recorrer media pista se vuelve al inicio sin salto
    if (next <= -half) next += half
    if (next > 0) next -= half
    x.set(next)
  })

  const row = (copy: number) =>
    items.map((it) => (
      <span key={`${copy}-${it}`} className="flex shrink-0 items-center gap-10 pr-10">
        <span>{it}</span>
        <span className="text-[0.5em] font-light text-(--l-signal)" aria-hidden>
          +
        </span>
      </span>
    ))

  return (
    <div className="overflow-hidden border-y border-(--l-hair) py-8 select-none" aria-label={items.join(', ')} role="img">
      <motion.div
        ref={track}
        className="flex w-max text-[clamp(2.75rem,7vw,6rem)] leading-none font-semibold tracking-[-0.04em] text-(--l-ink)"
        style={{ x }}
        aria-hidden
      >
        {row(0)}
        {row(1)}
      </motion.div>
    </div>
  )
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

function OdometerDigit({ digit, delay, run }: { digit: number; delay: number; run: boolean }) {
  return (
    <span className="relative inline-block h-[1em] overflow-hidden leading-none tabular-nums">
      <motion.span
        className="flex flex-col"
        initial={{ y: '0em' }}
        animate={{ y: run ? `-${digit}em` : '0em' }}
        transition={{ duration: 1.6, ease: EASE, delay }}
      >
        {DIGITS.map((d) => (
          <span key={d} className="h-[1em]">
            {d}
          </span>
        ))}
      </motion.span>
    </span>
  )
}

/** Número cuyas cifras ruedan verticalmente hasta su valor, como un odómetro. */
export function Odometer({ value, suffix, className }: { value: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useInView(ref, { once: true, amount: 0.6 })
  const reduce = useReducedMotion()
  const digits = String(value).split('').map(Number)
  return (
    <span ref={ref} className={clsx('inline-flex items-start', className)}>
      <span className="sr-only">
        {value}
        {suffix}
      </span>
      <span aria-hidden className="inline-flex">
        {reduce ? (
          <span className="tabular-nums">{value}</span>
        ) : (
          digits.map((d, i) => <OdometerDigit key={i} digit={d} run={seen} delay={i * 0.12} />)
        )}
        {suffix && <span className="ml-1 text-[0.42em] leading-[1.3] text-(--l-signal)">{suffix}</span>}
      </span>
    </span>
  )
}

/** Panel que se descubre con una cortina de abajo hacia arriba, con un leve zoom de salida. */
export function ClipReveal({ children, className }: { children: ReactNode; className?: string }) {
  // se observa el contenedor exterior: el recortado mide cero de área visible y no dispararía la entrada
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref, { once: true, amount: 0.2 })
  return (
    <div ref={ref}>
      <motion.div
        className={clsx('overflow-hidden', className)}
        initial={{ clipPath: 'inset(100% 0% 0% 0%)' }}
        animate={{ clipPath: seen ? 'inset(0% 0% 0% 0%)' : 'inset(100% 0% 0% 0%)' }}
        transition={{ duration: 1.2, ease: EASE }}
      >
        <motion.div
          className="size-full"
          initial={{ scale: 1.12 }}
          animate={{ scale: seen ? 1 : 1.12 }}
          transition={{ duration: 1.6, ease: EASE }}
        >
          {children}
        </motion.div>
      </motion.div>
    </div>
  )
}

/** Tarjeta que entra inclinada y se endereza, como las cifras de los sitios de estudio. */
export function TiltIn({ children, className, index = 0 }: { children: ReactNode; className?: string; index?: number }) {
  const from = [-6, 0, 6][index % 3]!
  return (
    <motion.div
      className={className}
      style={{ transformPerspective: 1200 }}
      initial={{ opacity: 0, y: 60, rotateZ: from, rotateX: 18 }}
      whileInView={{ opacity: 1, y: 0, rotateZ: 0, rotateX: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 1.1, ease: EASE, delay: index * 0.1 }}
    >
      {children}
    </motion.div>
  )
}

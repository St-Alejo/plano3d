/**
 * Primitivos de animación de la landing. Todas las entradas usan la misma curva
 * y duración para que el ritmo sea uniforme; con movimiento reducido el
 * `MotionConfig reducedMotion="user"` de la página las deja solo en fundido.
 */
import { animate, motion, useInView, useReducedMotion, type Variants } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { EASE } from './ease'

const rise: Variants = {
  hidden: { opacity: 0, y: 24, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.8, ease: EASE } },
}

const VIEWPORT = { once: true, margin: '0px 0px -12% 0px' } as const

/** Aparece al entrar en pantalla: sube 24 px y se enfoca. */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      variants={rise}
      initial="hidden"
      whileInView="show"
      viewport={VIEWPORT}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  )
}

/** Contenedor que escalona la entrada de sus `StaggerItem`. */
export function Stagger({
  children,
  className,
  as = 'div',
  gap = 0.08,
  ...rest
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'ol' | 'ul' | 'tbody'
  gap?: number
  'aria-label'?: string
}) {
  const Tag = motion[as]
  return (
    <Tag
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={VIEWPORT}
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap } } }}
      {...rest}
    >
      {children}
    </Tag>
  )
}

export function StaggerItem({ children, className, as = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'li' | 'tr' }) {
  const Tag = motion[as]
  return (
    <Tag className={className} variants={rise}>
      {children}
    </Tag>
  )
}

/** Número que cuenta hasta su valor la primera vez que se ve. */
export function CountUp({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useInView(ref, { once: true })
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (!seen || reduce) return
    const ctl = animate(0, value, { duration: 1.4, ease: EASE, onUpdate: setShown })
    return () => ctl.stop()
  }, [seen, reduce, value])
  return (
    <span ref={ref} className={className}>
      {/* el valor final queda disponible para lectores de pantalla y pruebas desde el inicio */}
      <span aria-hidden>{(reduce ? value : shown).toFixed(decimals)}</span>
      <span className="sr-only">{value.toFixed(decimals)}</span>
    </span>
  )
}

/**
 * Primitivos de animación de la landing. Todas las entradas usan la misma curva
 * y duración para que el ritmo sea uniforme; con movimiento reducido el
 * `MotionConfig reducedMotion="user"` de la página las deja solo en fundido.
 */
import { motion, type Variants } from 'motion/react'
import type { ReactNode } from 'react'

import { EASE } from './ease'

const rise: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
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

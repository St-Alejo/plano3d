/**
 * Movimientos atados al scroll de la landing: parallax, acercamiento de fotos y la línea de
 * cota que se dibuja junto a cada sección. Todo va por transformaciones (sin layout) y, con
 * movimiento reducido, se queda quieto: `useReducedMotion` corta el recorrido a cero.
 */
import { motion, useInView, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { useRef, type ReactNode } from 'react'

import { EASE } from './ease'

/** Desplaza su contenido `distance` px (arriba/abajo) mientras cruza la pantalla. */
export function Parallax({ children, distance = 60, className }: { children: ReactNode; distance?: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: box, offset: ['start end', 'end start'] })
  const d = reduce ? 0 : distance
  const y = useTransform(scrollYProgress, [0, 1], [d, -d])
  return (
    <div ref={box} className={className}>
      <motion.div style={{ y }} className="size-full">
        {children}
      </motion.div>
    </div>
  )
}

/** Marco que recorta una foto y la acerca (de `from` a 1) mientras entra en pantalla. */
export function ZoomIn({ children, from = 1.18, className }: { children: ReactNode; from?: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: box, offset: ['start end', 'end start'] })
  const scale = useTransform(scrollYProgress, [0, 0.6], [reduce ? 1 : from, 1])
  return (
    <div ref={box} className={className}>
      <motion.div style={{ scale }} className="size-full">
        {children}
      </motion.div>
    </div>
  )
}

/**
 * Cota del rótulo de sección: una línea con remates que se traza al entrar en pantalla, con el
 * número y el nombre de la sección encima (como una cota de plano).
 */
export function DimLine({ index, label }: { index: number; label: string }) {
  const box = useRef<HTMLDivElement>(null)
  const seen = useInView(box, { once: true, margin: '0px 0px -10% 0px' })
  const draw = { initial: { pathLength: 0 }, animate: seen ? { pathLength: 1 } : undefined, transition: { duration: 1.1, ease: EASE } }
  return (
    <div ref={box} className="grid max-w-md gap-2">
      <p className="t-label flex justify-between gap-4 text-(--l-dim)">
        <span className="text-(--l-text-accent)">{String(index).padStart(2, '0')}</span>
        <span>{label}</span>
      </p>
      <svg viewBox="0 0 400 12" preserveAspectRatio="none" className="h-3 w-full text-(--l-rule)" aria-hidden>
        <g stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" fill="none">
          <motion.path d="M1 6 H399" {...draw} vectorEffect="non-scaling-stroke" className="text-(--l-text-accent)" stroke="currentColor" />
          <path d="M1 0 V12 M399 0 V12" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
    </div>
  )
}

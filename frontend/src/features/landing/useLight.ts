/** Ganchos de los toques interactivos (ver interactive.tsx). */
import { animate, useMotionValue } from 'motion/react'
import { useEffect, useState } from 'react'

/** ¿Hay mouse? (en pantallas táctiles el punto se toca; el paso del cursor no existe) */
export function useFinePointer() {
  const [fine, setFine] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)')
    const on = () => setFine(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return fine
}

/**
 * Estado de una luz: `off` es la opacidad de la foto "apagada" encima de la "encendida".
 * Al encender parpadea como un bombillo que arranca (o, con `flicker = false`, se funde como una
 * puerta que se abre); al apagar se desvanece rápido.
 */
export function useLight(initial = false, flicker = true) {
  const [on, setOn] = useState(initial)
  const off = useMotionValue(initial ? 0 : 1)
  const glow = useMotionValue(0)
  useEffect(() => {
    if (on) {
      const a = flicker
        ? animate(off, [1, 0.35, 0.9, 0.15, 0.55, 0], { duration: 1.1, times: [0, 0.15, 0.3, 0.5, 0.65, 1], ease: 'easeOut' })
        : animate(off, 0, { duration: 0.9, ease: [0.65, 0, 0.35, 1] })
      const b = animate(glow, [0, 0.55, 0.3], { duration: 1.6, times: [0, 0.4, 1] })
      return () => (a.stop(), b.stop())
    }
    const a = animate(off, 1, { duration: 0.45 })
    const b = animate(glow, 0, { duration: 0.45 })
    return () => (a.stop(), b.stop())
  }, [on, off, glow, flicker])
  return { on, setOn, off, glow }
}


/**
 * Scroll con inercia (Lenis) mientras la landing está montada. Usa el scroll
 * nativo de la ventana, así que `useScroll` de motion y los `sticky` siguen
 * funcionando igual. Con movimiento reducido no se activa.
 */
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { useEffect } from 'react'

import { prefersReducedMotion } from '@/features/viewer3d/motion'

export function useSmoothScroll(): void {
  useEffect(() => {
    if (prefersReducedMotion()) return
    const lenis = new Lenis({
      autoRaf: true,
      lerp: 0.1,
      // los enlaces #seccion se desplazan con la misma inercia, dejando sitio a la cabecera fija
      anchors: { offset: -96 },
    })
    return () => lenis.destroy()
  }, [])
}

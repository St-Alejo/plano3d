/** Pantalla completa del navegador (Fullscreen API), tolerante a navegadores que no la tienen. */
import { useEffect, useState } from 'react'

export const fullscreenSupported = () => typeof document !== 'undefined' && !!document.documentElement.requestFullscreen

export function isFullscreen(): boolean {
  return typeof document !== 'undefined' && !!document.fullscreenElement
}

/** Entra o sale de pantalla completa. El navegador puede negarlo (p. ej. sin gesto del usuario). */
export async function toggleFullscreen(): Promise<void> {
  try {
    if (isFullscreen()) await document.exitFullscreen()
    else if (fullscreenSupported()) await document.documentElement.requestFullscreen()
  } catch {
    /* sin permiso o no soportado: el estudio sigue ocupando toda la ventana */
  }
}

export function useIsFullscreen(): boolean {
  const [on, setOn] = useState(isFullscreen)
  useEffect(() => {
    const fn = () => setOn(isFullscreen())
    document.addEventListener('fullscreenchange', fn)
    return () => document.removeEventListener('fullscreenchange', fn)
  }, [])
  return on
}

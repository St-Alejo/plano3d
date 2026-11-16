/**
 * Abre la sala de edición en vivo del proyecto mientras el editor está montado.
 * Solo con sesión iniciada: sin cuentas (desarrollo local, pruebas) el editor guarda
 * por REST como siempre.
 */
import { useEffect } from 'react'
import { useAuth } from '@/store/authStore'
import { useEditor } from '@/store/editorStore'
import { CollabSession } from './CollabSession'
import { useCollab } from './collabStore'

/**
 * `localStorage['plano3d.live'] = 'off'` apaga la edición en vivo en este navegador: se
 * vuelve al guardado manual con aviso de conflicto (lo usan las pruebas de ese camino,
 * que sigue siendo el de respaldo sin conexión en vivo).
 */
export function liveEditingDisabled(): boolean {
  try {
    return window.localStorage.getItem('plano3d.live') === 'off'
  } catch {
    return false
  }
}

export function useLiveEditing(projectId: string, enabled = true): void {
  const signedIn = useAuth((s) => s.status === 'signedIn')
  const on = enabled && signedIn && !liveEditingDisabled()
  useEffect(() => {
    if (!on) return
    const session = new CollabSession(projectId, { editor: useEditor })
    session.start()
    return () => session.stop()
  }, [projectId, on])
}

/** ¿El servidor guarda solo? (sala abierta y conectada) */
export const useIsLive = (): boolean => useCollab((s) => s.status === 'live')

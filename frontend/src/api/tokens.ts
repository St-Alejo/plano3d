/**
 * Tokens de la sesión (ADR-020).
 *
 * - El de acceso (60 min) vive solo en memoria: no lo puede leer un script inyectado en
 *   otra pestaña ni queda en disco.
 * - El de refresco (30 días) va en localStorage para no pedir la contraseña en cada visita.
 *   Static Web Apps (plan gratis) no puede poner cookies del mismo sitio para la API.
 */
import type { components } from './schema'

export type Session = components['schemas']['SessionDTO']
export type SessionUser = components['schemas']['UserDTO']

const REFRESH_KEY = 'plano3d.refresh'

let access: string | null = null
let user: SessionUser | null = null
type Listener = (user: SessionUser | null) => void
const listeners = new Set<Listener>()

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null // modo privado o almacenamiento bloqueado
  }
}

export const tokens = {
  access: () => access,
  user: () => user,
  refresh: (): string | null => {
    try {
      return storage()?.getItem(REFRESH_KEY) ?? null
    } catch {
      return null
    }
  },
  set(session: Session) {
    access = session.access_token
    user = session.user
    try {
      storage()?.setItem(REFRESH_KEY, session.refresh_token)
    } catch {
      /* sin almacenamiento: la sesión dura lo que la pestaña */
    }
    listeners.forEach((l) => l(user))
  },
  clear() {
    access = null
    user = null
    try {
      storage()?.removeItem(REFRESH_KEY)
    } catch {
      /* nada que borrar */
    }
    listeners.forEach((l) => l(null))
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

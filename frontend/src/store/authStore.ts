/**
 * Sesión de la web (ADR-020): quién entró y si el servidor pide cuenta.
 *
 * - `loading`: todavía no se sabe (primera carga).
 * - `open`: el servidor corre sin cuentas (desarrollo, pruebas): todo es visible.
 * - `signedIn` / `signedOut`: con cuentas.
 */
import { create } from 'zustand'
import { api, ApiError, refreshSession } from '@/api/client'
import { tokens, type Session, type SessionUser } from '@/api/tokens'

export type AuthStatus = 'loading' | 'open' | 'signedIn' | 'signedOut'

interface AuthState {
  status: AuthStatus
  user: SessionUser | null
  demoEnabled: boolean
  /** el servidor no respondió al arrancar */
  offline: boolean
  bootstrap: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, name: string, password: string) => Promise<void>
  demo: () => Promise<void>
  logout: () => Promise<void>
}

let booting: Promise<void> | null = null

export const useAuth = create<AuthState>()((set, get) => {
  const enter = (session: Session) => {
    tokens.set(session) // el suscriptor de abajo pasa el estado a signedIn
  }
  // un refresco rechazado (o el cierre en otra parte) saca de la sesión a la pantalla
  tokens.subscribe((user) => {
    // antes de saber si hay cuentas manda bootstrap; sin cuentas no hay sesión que seguir
    const { status } = get()
    if (status === 'loading' || status === 'open') return
    set(user ? { status: 'signedIn', user } : { status: 'signedOut', user: null })
  })

  return {
    status: 'loading',
    user: null,
    demoEnabled: false,
    offline: false,

    bootstrap: () => {
      booting ??= (async () => {
        try {
          const config = await api.auth.config()
          set({ demoEnabled: config.demo_enabled, offline: false })
          if (!config.auth_required) {
            set({ status: 'open', user: null })
            return
          }
          if (tokens.access() || (await refreshSession())) {
            set({ status: 'signedIn', user: tokens.user() })
          } else {
            set({ status: 'signedOut', user: null })
          }
        } catch (e) {
          // sin servidor: se muestra la entrada con el aviso; se puede reintentar
          set({ status: 'signedOut', user: null, offline: e instanceof ApiError && e.status === 0 })
          booting = null
        }
      })()
      return booting
    },

    login: async (email, password) => enter(await api.auth.login(email, password)),
    register: async (email, name, password) => enter(await api.auth.register(email, name, password)),
    demo: async () => enter(await api.auth.demo()),

    logout: async () => {
      try {
        await api.auth.logout()
      } catch {
        /* el token ya no servía: igual se borra la sesión local */
      }
      tokens.clear()
    },
  }
})

/** Solo para pruebas: vuelve al estado inicial. */
export function resetAuthForTests() {
  booting = null
  useAuth.setState({ status: 'loading', user: null, demoEnabled: false, offline: false })
}

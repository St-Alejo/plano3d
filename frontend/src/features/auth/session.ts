import { useEffect } from 'react'
import { useAuth } from '@/store/authStore'

/** Destino seguro tras entrar: solo rutas internas (nada de `//otro-sitio`). */
export function safeNext(raw: string | null, fallback = '/proyectos'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  return raw
}

/** Pide la sesión una vez al montar (la primera pantalla que la necesite). */
export function useAuthBootstrap() {
  const status = useAuth((s) => s.status)
  const bootstrap = useAuth((s) => s.bootstrap)
  useEffect(() => {
    if (status === 'loading') void bootstrap()
  }, [status, bootstrap])
  return status
}

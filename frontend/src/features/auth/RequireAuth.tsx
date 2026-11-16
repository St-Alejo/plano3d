import { Navigate, Outlet, useLocation } from 'react-router'
import { Spinner } from '@/components/ui'
import { useAuthBootstrap } from './session'

/** Rutas de la app (proyectos, editor, visor): sin sesión llevan a la entrada y vuelven. */
export function RequireAuth() {
  const status = useAuthBootstrap()
  const location = useLocation()
  if (status === 'loading')
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Abriendo tu sesión" />
      </div>
    )
  if (status === 'signedOut') {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/entrar?next=${encodeURIComponent(next)}`} replace />
  }
  return <Outlet />
}

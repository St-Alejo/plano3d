import { lazy, Suspense } from 'react'
import { Spinner } from '@/components/ui'

const ViewerPage = lazy(() => import('./ViewerPage').then((m) => ({ default: m.ViewerPage })))

/** El visor 3D (Three.js) se descarga solo cuando se entra al recorrido. */
export function LazyViewerPage() {
  return (
    <Suspense fallback={<div className="p-8"><Spinner label="Cargando visor 3D" /></div>}>
      <ViewerPage />
    </Suspense>
  )
}

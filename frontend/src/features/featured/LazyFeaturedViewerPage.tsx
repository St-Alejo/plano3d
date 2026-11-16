import { lazy, Suspense } from 'react'
import { Spinner } from '@/components/ui'

const FeaturedViewerPage = lazy(() => import('./FeaturedViewerPage').then((m) => ({ default: m.FeaturedViewerPage })))

/** El visor público trae Three.js: se descarga solo al abrir un destacado. */
export function LazyFeaturedViewerPage() {
  return (
    <Suspense fallback={<div className="p-8"><Spinner label="Cargando visor 3D" /></div>}>
      <FeaturedViewerPage />
    </Suspense>
  )
}

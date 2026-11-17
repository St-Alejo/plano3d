import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import type { RouteObject } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { NotFound } from '@/components/NotFound'
import { Spinner } from '@/components/ui'
import { AuthPage } from '@/features/auth/AuthPage'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { LazyViewerPage } from '@/features/viewer3d/LazyViewerPage'
import { LazyFeaturedViewerPage } from '@/features/featured/LazyFeaturedViewerPage'
import { DesktopPage } from '@/features/desktop/DesktopPage'
import { LandingPage } from '@/features/landing/LandingPage'

// Las páginas de trabajo (editor 2D con Konva, estudio, visor) se descargan al entrar a ellas:
// así la portada no carga three.js ni konva (rendimiento en Lighthouse).
function page(load: () => Promise<ComponentType>): () => ReactNode {
  const Page = lazy(() => load().then((C) => ({ default: C })))
  return function LazyPage() {
    return (
      <Suspense fallback={<div className="p-8"><Spinner label="Cargando" /></div>}>
        <Page />
      </Suspense>
    )
  }
}
const ProjectsPage = page(() => import('@/features/projects/ProjectsPage').then((m) => m.ProjectsPage))
const NewPlanPage = page(() => import('@/features/capture/NewPlanPage').then((m) => m.NewPlanPage))
const ProjectPage = page(() => import('@/features/workspace/ProjectPage').then((m) => m.ProjectPage))
const StudioPage = page(() => import('@/features/studio/StudioPage').then((m) => m.StudioPage))

export const routes: RouteObject[] = [
  // la landing tiene su propio cajetín: va fuera del AppShell
  { index: true, element: <LandingPage />, errorElement: <NotFound /> },
  { path: 'entrar', element: <AuthPage mode="login" />, errorElement: <NotFound /> },
  { path: 'registro', element: <AuthPage mode="register" />, errorElement: <NotFound /> },
  // proyectos destacados: públicos, sin cuenta y de solo lectura
  { path: 'destacados/:id', element: <LazyFeaturedViewerPage />, errorElement: <NotFound /> },
  // todo lo que muestra proyectos pide sesión (ADR-020)
  {
    element: <RequireAuth />,
    errorElement: <NotFound />,
    children: [
      // el estudio ocupa toda la ventana: sin la cabecera de la aplicación
      { path: 'p/:id/estudio', element: <StudioPage /> },
      {
        element: <AppShell />,
        children: [
          { path: 'proyectos', element: <ProjectsPage /> },
          { path: 'nuevo', element: <NewPlanPage /> },
          { path: 'p/:id', element: <ProjectPage /> },
          { path: 'p/:id/3d', element: <LazyViewerPage /> },
        ],
      },
    ],
  },
  // públicas con la cabecera de la aplicación
  {
    element: <AppShell />,
    errorElement: <NotFound />,
    children: [
      { path: 'escritorio', element: <DesktopPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]

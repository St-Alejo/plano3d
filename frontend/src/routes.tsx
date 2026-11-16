import type { RouteObject } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { NotFound } from '@/components/NotFound'
import { AuthPage } from '@/features/auth/AuthPage'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { LazyViewerPage } from '@/features/viewer3d/LazyViewerPage'
import { NewPlanPage } from '@/features/capture/NewPlanPage'
import { DesktopPage } from '@/features/desktop/DesktopPage'
import { LandingPage } from '@/features/landing/LandingPage'
import { ProjectsPage } from '@/features/projects/ProjectsPage'
import { StudioPage } from '@/features/studio/StudioPage'
import { ProjectPage } from '@/features/workspace/ProjectPage'

export const routes: RouteObject[] = [
  // la landing tiene su propio cajetín: va fuera del AppShell
  { index: true, element: <LandingPage />, errorElement: <NotFound /> },
  { path: 'entrar', element: <AuthPage mode="login" />, errorElement: <NotFound /> },
  { path: 'registro', element: <AuthPage mode="register" />, errorElement: <NotFound /> },
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

import type { RouteObject } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { NotFound } from '@/components/NotFound'
import { LazyViewerPage } from '@/features/viewer3d/LazyViewerPage'
import { NewPlanPage } from '@/features/capture/NewPlanPage'
import { ProjectsPage } from '@/features/projects/ProjectsPage'
import { ProjectPage } from '@/features/workspace/ProjectPage'

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <NotFound />,
    children: [
      { index: true, element: <ProjectsPage /> },
      { path: 'nuevo', element: <NewPlanPage /> },
      { path: 'p/:id', element: <ProjectPage /> },
      { path: 'p/:id/3d', element: <LazyViewerPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]


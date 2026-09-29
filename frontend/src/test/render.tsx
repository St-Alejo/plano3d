import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'

/** Renderiza un elemento dentro de un router en memoria, con rutas extra para verificar navegación. */
export function renderWithRouter(element: ReactElement, { path = '/', initial = '/' } = {}) {
  const router = createMemoryRouter(
    [
      { path, element },
      { path: '/p/:id', element: <p>pantalla del proyecto</p> },
      { path: '/nuevo', element: <p>pantalla nuevo</p> },
      { path: '*', element: <p>otra ruta</p> },
    ],
    { initialEntries: [initial] },
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

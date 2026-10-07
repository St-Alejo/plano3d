import { fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'

import { wall } from '@/test/fixtures'
import { polygonArea } from '@/domain/model'
import { NewPlanPage } from '@/features/capture/NewPlanPage'
import { solidSpans } from './drawPlan'
import { LandingPage } from './LandingPage'
import { sampleApartment } from './sampleApartment'
import { FIGURES, sceneAt } from './sequence'

describe('sceneAt (coreografía del hero)', () => {
  it('arranca con la foto torcida y termina dentro del apartamento', () => {
    const start = sceneAt(0)
    expect(start).toMatchObject({ figure: 0, skew: 1, trace: 0, extrude: 0, camera: 0 })
    const end = sceneAt(1)
    expect(end).toMatchObject({ figure: FIGURES.length - 1, skew: 0, trace: 1, extrude: 1, camera: 2 })
  })

  it('cada etapa avanza sin retroceder y recorre las cinco figuras', () => {
    let prev = sceneAt(0)
    const seen = new Set<number>()
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const s = sceneAt(p)
      expect(s.extrude).toBeGreaterThanOrEqual(prev.extrude)
      expect(s.camera).toBeGreaterThanOrEqual(prev.camera)
      expect(s.skew).toBeLessThanOrEqual(prev.skew)
      seen.add(s.figure)
      prev = s
    }
    expect(seen.size).toBe(FIGURES.length)
    // fuera de rango se acota
    expect(sceneAt(-1)).toEqual(sceneAt(0))
    expect(sceneAt(2)).toEqual(sceneAt(1))
  })
})

describe('solidSpans', () => {
  it('descuenta los vanos del muro', () => {
    const w = wall('w', 0, 0, 5, 0, [
      { id: 'a', kind: 'door', offset: 1, width: 1, height: 2.1, sill: 0, confidence: 1 },
      { id: 'b', kind: 'window', offset: 3, width: 1.5, height: 1.2, sill: 0.9, confidence: 1 },
    ])
    expect(solidSpans(w)).toEqual([
      [0, 1],
      [2, 3],
      [4.5, 5],
    ])
  })

  it('un vano en el extremo no deja tramos vacíos', () => {
    const w = wall('w', 0, 0, 2, 0, [{ id: 'a', kind: 'door', offset: 0, width: 0.9, height: 2.1, sill: 0, confidence: 1 }])
    expect(solidSpans(w)).toEqual([[0.9, 2]])
  })
})

describe('apartamento de muestra', () => {
  it('tiene cinco ambientes y unos 50 m² útiles', () => {
    const rooms = sampleApartment().levels.flatMap((l) => l.rooms)
    expect(rooms.map((r) => r.label)).toEqual(['Sala-comedor', 'Cocina', 'Alcoba principal', 'Alcoba 2', 'Baño'])
    const total = rooms.reduce((s, r) => s + polygonArea(r.polygon), 0)
    expect(total).toBeGreaterThan(48)
    expect(total).toBeLessThan(52)
  })
})

function renderLanding() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <LandingPage /> },
      { path: '/nuevo', element: <NewPlanPage /> },
      { path: '/proyectos', element: <p>pantalla proyectos</p> },
    ],
    { initialEntries: ['/'] },
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('LandingPage', () => {
  it('presenta el producto y lleva a la app', () => {
    renderLanding()
    expect(screen.getAllByRole('heading', { level: 1, name: /foto de tu plano/ }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /Convertir un plano/ })[0]).toHaveAttribute('href', '/nuevo')
    expect(screen.getByRole('link', { name: /Abrir la app/ })).toHaveAttribute('href', '/proyectos')
    expect(screen.getByRole('link', { name: /Ver mis proyectos/ })).toHaveAttribute('href', '/proyectos')
    for (const name of [/sin dibujar nada/, /Qué le das/, /lo corriges tú/, /Cada ambiente/, /Tu plano, en 3D/])
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
  })

  it('sin WebGL muestra los cinco pasos como lista', () => {
    renderLanding()
    FIGURES.forEach((f, i) => {
      expect(screen.getByText(`Paso ${i + 1}`)).toBeInTheDocument()
      expect(screen.getByText(f.title)).toBeInTheDocument()
    })
  })

  it('presenta la declaración, la marquesina y las cifras con su valor final accesible', () => {
    renderLanding()
    expect(screen.getByText(/convierte el plano que ya tienes/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Muros, Puertas, Ventanas/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /entre la foto y el modelo/ })).toBeInTheDocument()
    // las cifras ruedan dígito a dígito; el valor completo queda en texto solo para lectores de pantalla
    const facts = screen.getByRole('region', { name: /entre la foto y el modelo/ })
    const readable = within(facts)
      .getAllByText(/^\d+(MB|cm)?$/)
      .filter((el) => el.classList.contains('sr-only'))
      .map((el) => el.textContent)
    expect(readable).toEqual(['10', '3', '25MB', '1cm'])
  })

  it('el cuadro de áreas suma los ambientes', () => {
    renderLanding()
    const table = screen.getByRole('table', { name: /Cuadro de áreas/ })
    const rows = within(table).getAllByRole('row')
    // encabezado + 5 ambientes + total
    expect(rows).toHaveLength(7)
    const total = sampleApartment()
      .levels.flatMap((l) => l.rooms)
      .reduce((s, r) => s + polygonArea(r.polygon), 0)
    // el total visible cuenta hacia arriba; el valor final siempre está para lectores de pantalla
    expect(within(table).getAllByText(total.toFixed(2)).length).toBeGreaterThan(0)
  })

  it('el archivo elegido en la landing llega a la captura con el nombre sugerido', async () => {
    const { router, container } = renderLanding()
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!
    fireEvent.change(input, { target: { files: [new File(['%PDF'], 'casa_campo.pdf', { type: 'application/pdf' })] } })
    expect(await screen.findByLabelText('Nombre del proyecto')).toHaveValue('casa campo')
    expect(router.state.location.pathname).toBe('/nuevo')
  })
})

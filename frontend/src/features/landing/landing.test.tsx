import { fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'

import { wall } from '@/test/fixtures'
import { polygonArea } from '@/domain/model'
import { NewPlanPage } from '@/features/capture/NewPlanPage'
import { solidSpans } from './drawPlan'
import { LandingPage } from './LandingPage'
import { sampleApartment } from './sampleApartment'
import { cameraAt, sceneAt, STAGES, type Pose } from './sequence'

describe('sceneAt (coreografía del hero)', () => {
  it('arranca con el plano en holograma y termina dentro de la casa terminada', () => {
    expect(sceneAt(0)).toMatchObject({ stage: 0, holo: 1, build: 0, sweep: 0, interior: 0 })
    expect(sceneAt(1)).toMatchObject({ stage: STAGES.length - 1, holo: 0, build: 3, sweep: 1, interior: 1 })
  })

  it('la obra, el barrido y la entrada avanzan sin retroceder y se pasa por las seis etapas', () => {
    let prev = sceneAt(0)
    const seen = new Set<number>()
    for (let p = 0; p <= 1.0001; p += 0.005) {
      const s = sceneAt(p)
      expect(s.build).toBeGreaterThanOrEqual(prev.build)
      expect(s.sweep).toBeGreaterThanOrEqual(prev.sweep)
      expect(s.interior).toBeGreaterThanOrEqual(prev.interior)
      expect(s.holo).toBeLessThanOrEqual(prev.holo + 1e-9)
      seen.add(s.stage)
      prev = s
    }
    expect(seen.size).toBe(STAGES.length)
    expect(sceneAt(-1)).toEqual(sceneAt(0))
    expect(sceneAt(2)).toEqual(sceneAt(1))
  })

  it('cada tramo de obra se construye en su etapa: al nombrar "Muros" ya está la cimentación', () => {
    const mid = (i: number) => (i + 0.5) / STAGES.length
    expect(sceneAt(mid(1)).build).toBeGreaterThan(0.3)
    expect(sceneAt(mid(1)).build).toBeLessThan(1)
    expect(sceneAt(mid(2)).build).toBeGreaterThan(1.3)
    expect(sceneAt(mid(3)).build).toBeGreaterThan(2.3)
    expect(sceneAt(mid(4)).sweep).toBeGreaterThan(0.3)
  })
})

describe('cameraAt', () => {
  const keys = [
    { p: 0, pose: { pos: [0, 10, 0], look: [0, 0, 0] } as Pose },
    { p: 0.5, pose: { pos: [10, 10, 0], look: [0, 0, 0] } as Pose },
    { p: 1, pose: { pos: [10, 2, 10], look: [5, 1, 5] } as Pose },
  ]
  it('pasa exactamente por las poses clave y queda entre ellas en medio', () => {
    expect(cameraAt(0, keys).pos).toEqual([0, 10, 0])
    expect(cameraAt(0.5, keys).pos).toEqual([10, 10, 0])
    expect(cameraAt(1, keys)).toEqual(keys[2]!.pose)
    const x = cameraAt(0.25, keys).pos[0]
    expect(x).toBeGreaterThan(0)
    expect(x).toBeLessThan(10)
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
    expect(screen.getByRole('heading', { level: 1, name: /Tu casa, desde el plano/ })).toBeInTheDocument()
    expect(screen.getByText(/Toma una foto de tu plano/)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Convertir un plano/ })[0]).toHaveAttribute('href', '/nuevo')
    expect(screen.getByRole('link', { name: /Abrir la app/ })).toHaveAttribute('href', '/proyectos')
    expect(screen.getByRole('link', { name: /Ver mis proyectos/ })).toHaveAttribute('href', '/proyectos')
    for (const name of [/Seis maneras/, /Del papel al modelo/, /Camínala/, /Qué le das/, /Cada ambiente/, /Tu plano, en 3D/])
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
  })

  it('sin WebGL cuenta las seis etapas, del plano al hogar', () => {
    renderLanding()
    const list = screen.getByRole('list', { name: /Etapas, del plano al hogar/ })
    const items = within(list).getAllByRole('listitem')
    expect(items.map((li) => li.firstChild?.textContent)).toEqual(STAGES.map((s) => s.title))
  })

  it('cada capacidad enlaza a su tutorial o a empezar, con su captura', () => {
    renderLanding()
    const list = screen.getByRole('list', { name: 'Qué puedes hacer' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(6)
    expect(within(list).getByRole('link', { name: 'Editor de planos' })).toHaveAttribute('href', '/tutoriales/editar.webm')
    expect(within(list).getByRole('link', { name: 'Secuencia de obra' })).toHaveAttribute('href', '/nuevo')
    expect(screen.getAllByRole('img', { name: /editor con el plano en 2D/ }).length).toBeGreaterThan(0)
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

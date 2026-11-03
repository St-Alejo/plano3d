import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BuildingModel } from '@/api/types'
import { titleCase } from '@/lib/text'
import opc3 from '@/test/opc3.json'
import { sampleProject } from '@/test/fixtures'
import { server } from '@/test/server'
import { createCarMesh, createPerson, posePerson } from './scene/actors'
import { useSim } from './simStore'
import { asViewerActions, parseViewerChat } from './viewerCommands'
import { ViewerPage } from './ViewerPage'
import { WalkHud } from './WalkHud'
import { useWalk } from './walkStore'

// WebGL no funciona en jsdom: el visor dice si la simulación está permitida
vi.mock('./Viewer3D', () => ({
  Viewer3D: ({ simulation }: { simulation?: boolean }) => <div data-testid="viewer" data-sim={simulation ? 'si' : 'no'} />,
}))

const opc3Model = opc3 as unknown as BuildingModel

function renderViewer(model?: BuildingModel) {
  server.use(http.get('/api/projects/:id', () => HttpResponse.json(model ? sampleProject({ model }) : sampleProject())))
  const router = createMemoryRouter([{ path: '/p/:id/3d', element: <ViewerPage /> }], { initialEntries: ['/p/prj_1/3d'] })
  return render(<RouterProvider router={router} />)
}

const realMatchMedia = window.matchMedia
/** Simula una pantalla de `width` px para las consultas `max-width` / `min-width`. */
function screenWidth(width: number) {
  window.matchMedia = (query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = max ? width <= Number(max[1]) : min ? width >= Number(min[1]) : false
    return { matches, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false } as MediaQueryList
  }
}

beforeEach(() => {
  useSim.setState({ on: false, paused: false, people: 5, car: true, dayNight: true, hour: 8, night: false, marks: { people: [], cars: [] } })
})
afterEach(() => {
  window.matchMedia = realMatchMedia
})

describe('simulación en la página 3D', () => {
  it('el botón Simulación la prende y aparece el reloj con pausa', async () => {
    renderViewer()
    const button = await screen.findByRole('button', { name: 'Simulación: personas y carro' })
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-sim', 'si')
    await userEvent.click(button)
    expect(useSim.getState().on).toBe(true)
    expect(screen.getByRole('button', { name: 'Detener la simulación' })).toHaveAttribute('aria-pressed', 'true')
    const clock = screen.getByRole('status', { name: 'Reloj de la simulación' })
    expect(clock).toHaveTextContent('08:00')
    await userEvent.click(within(clock).getByRole('button', { name: 'Pausar la simulación' }))
    expect(useSim.getState().paused).toBe(true)
  })

  it('en la pestaña Vista se eligen personas, carro y hora', async () => {
    screenWidth(1280)
    renderViewer()
    await userEvent.click(await screen.findByRole('tab', { name: 'Vista' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Simulación (personas y carro)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Una persona más' }))
    expect(useSim.getState().people).toBe(6)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Carro al garaje' }))
    expect(useSim.getState().car).toBe(false)
    const before = useSim.getState().callNonce
    await userEvent.click(screen.getByRole('button', { name: /Llamar al carro/ }))
    expect(useSim.getState().callNonce).toBe(before + 1)
    expect(useSim.getState().car).toBe(true)
  })

  it('el chat la maneja: "pon la simulación", "hazlo de noche", "que entre el carro", "detén la simulación"', async () => {
    expect(parseViewerChat('pon la simulación').actions).toEqual([{ a: 'simulation', on: true }])
    expect(parseViewerChat('hazlo de noche').actions).toEqual([{ a: 'simulation', on: true, hour: 21 }])
    expect(parseViewerChat('que entre el carro').actions).toEqual([{ a: 'simulation', on: true, car: true, call: true }])
    expect(parseViewerChat('pon 3 personas').actions).toEqual([{ a: 'simulation', on: true, people: 3 }])
    expect(parseViewerChat('detén la simulación').actions).toEqual([{ a: 'simulation', on: false }])
    expect(parseViewerChat('quita el carro').actions).toEqual([{ a: 'simulation', car: false }])
    expect(parseViewerChat('5 personas en el segundo piso').ambiguous).toEqual([])
    expect(asViewerActions([{ a: 'simulation', on: true, people: 40 }, { a: 'simulation', hour: 21 }])).toEqual([{ a: 'simulation', hour: 21 }])
  })

  it('en tablet y celular lo secundario va al menú "Más" y la barra no desborda', async () => {
    screenWidth(375)
    renderViewer()
    const more = await screen.findByRole('button', { name: 'Más opciones' })
    expect(screen.queryByRole('button', { name: /^Fachada:/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Exportar' })).not.toBeInTheDocument()
    await userEvent.click(more)
    const items = screen.getAllByRole('menuitem').map((m) => m.textContent)
    expect(items).toEqual(expect.arrayContaining(['Simulación: personas y carro', 'Fachada: Moderna blanca', 'Exportar para Blender (.zip)']))
  })

  it('al recorrer, el panel se pliega solo', async () => {
    screenWidth(1280)
    renderViewer()
    const toggle = await screen.findByRole('button', { name: /Ambientes/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(screen.getByRole('radio', { name: 'Recorrer' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('la lista de ambientes va por piso y sin MAYÚSCULAS sostenidas', async () => {
    screenWidth(1280)
    renderViewer(opc3Model)
    const nav = await screen.findByRole('navigation', { name: 'Ambientes' })
    const piso2 = within(nav).getByRole('group', { name: 'Piso 2' })
    expect(within(piso2).getByRole('button', { name: 'Alcoba 1, Piso 2' })).toBeInTheDocument()
    expect(within(nav).getByRole('group', { name: 'Piso 3' })).toBeInTheDocument()
    expect(within(nav).queryByText('ALCOBA 1')).not.toBeInTheDocument()
    expect(titleCase('SALA-COMEDOR / COCINA')).toBe('Sala-comedor / cocina')
    expect(titleCase('Baño 1')).toBe('Baño 1')
  })
})

describe('minimapa con la simulación', () => {
  it('marca a las personas del piso actual y el carro en el primer piso', () => {
    const [p1, p2] = [...opc3Model.levels].sort((a, b) => a.elevation - b.elevation)
    useWalk.getState().reset()
    useWalk.getState().setHud({ x: 5, z: 6, y: 0, heading: 0, levelId: p1!.id, levelIndex: 0, levelCount: 3, levelName: p1!.name })
    try {
      localStorage.setItem('plano3d-ayuda-recorrido', '1')
    } catch {
      /* sin almacenamiento */
    }
    useSim.setState({
      on: true,
      marks: {
        people: [
          { id: 0, x: 5, z: 4, levelId: p1!.id, color: '#c2553a' },
          { id: 1, x: 5, z: 4, levelId: p2!.id, color: '#3c6f93' },
        ],
        cars: [{ id: 0, x: 4, z: 10, yaw: 0, visible: true }],
      },
    })
    render(<WalkHud model={opc3Model} touch={false} />)
    expect(screen.getAllByTestId('minimapa-persona')).toHaveLength(1)
    expect(screen.getAllByTestId('minimapa-carro')).toHaveLength(1)
  })
})

describe('maniquíes y carro', () => {
  it('el maniquí camina balanceando las piernas y se sienta con las rodillas dobladas', () => {
    const rig = createPerson(2)
    const meshes: THREE.Mesh[] = []
    rig.root.traverse((o) => o instanceof THREE.Mesh && meshes.push(o))
    expect(meshes.length).toBeGreaterThan(10)
    expect(meshes.every((m) => m.userData.kind === 'person')).toBe(true)
    posePerson(rig, { x: 1, z: 2, y: 0, yaw: 0, pose: 'walk' }, 1.1, 0.2)
    expect(rig.hips[0].rotation.x).not.toBeCloseTo(rig.hips[1].rotation.x)
    // rumbo 0 = +x en planta: mira hacia +x de la escena
    const ahead = new THREE.Vector3(0, 0, 1).applyEuler(rig.root.rotation)
    expect(ahead.x).toBeCloseTo(1)
    posePerson(rig, { x: 1, z: 2, y: 0.45, yaw: 0, pose: 'sit' }, 0, 0.1)
    expect(rig.hips[0].rotation.x).toBeCloseTo(-Math.PI / 2)
    expect(rig.knees[0].rotation.x).toBeCloseTo(Math.PI / 2)
    // los pies quedan en el piso: asiento a 0,45 y canilla de 0,45
    rig.root.updateMatrixWorld(true)
    const foot = new THREE.Vector3()
    rig.knees[0].getWorldPosition(foot)
    expect(foot.y).toBeCloseTo(0.45, 1)
  })

  it('el carro tiene 4 ruedas y prende las luces de noche', () => {
    const rig = createCarMesh(0)
    expect(rig.wheels).toHaveLength(4)
    expect(rig.root.userData.kind).toBe('car')
    expect(rig.lights[0]!.emissiveIntensity).toBe(0)
  })
})

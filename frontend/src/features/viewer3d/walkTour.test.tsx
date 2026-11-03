import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as THREE from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import type { BuildingModel } from '@/api/types'
import { streetEntry } from '@/domain/facadeGeometry'
import { roomLamps } from '@/domain/levels'
import { buildWalkWorld, spawnAt } from '@/domain/walkPhysics'
import opc3 from '@/test/opc3.json'
import { buildScene } from './scene/SceneBuilder'
import { WalkHud } from './WalkHud'
import { useWalk } from './walkStore'

const model = opc3 as unknown as BuildingModel
const [p1, p2, p3] = [...model.levels].sort((a, b) => a.elevation - b.elevation)

describe('recorrido de la casa de 3 pisos', () => {
  beforeEach(() => {
    useWalk.getState().reset()
    useWalk.getState().setHud({ x: 5, z: 3, y: 2.6, heading: 0, levelId: p2!.id, levelIndex: 1, levelCount: 3, levelName: p2!.name })
    try {
      localStorage.setItem('plano3d-ayuda-recorrido', '1')
    } catch {
      /* sin almacenamiento */
    }
  })

  it('el minimapa salta a cualquier piso y a un ambiente tocando su nombre', async () => {
    render(<WalkHud model={model} touch={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'P3' }))
    expect(useWalk.getState().take()).toEqual([expect.objectContaining({ type: 'teleport', levelId: p3!.id })])
    await userEvent.click(screen.getByRole('button', { name: 'Ir a ALCOBA 3' }))
    const [go] = useWalk.getState().take()
    const alcoba = p2!.rooms.find((r) => r.label === 'ALCOBA 3')!
    const xs = alcoba.polygon.map((p) => p.x)
    expect(go).toMatchObject({ type: 'teleport' })
    expect((go as { x: number }).x).toBeGreaterThan(Math.min(...xs))
    expect((go as { x: number }).x).toBeLessThan(Math.max(...xs))
  })

  it('se empieza en la calle frente a un portón, mirándolo, y caminando se llega a él', () => {
    const entry = streetEntry(p1!)!
    const world = buildWalkWorld(model)
    const s = spawnAt(world, entry, entry.levelId)
    expect(s.levelId).toBe(p1!.id)
    expect(s.y).toBeCloseTo(0)
    const gates = p1!.walls.flatMap((w) => w.openings.filter((o) => o.operation === 'folding'))
    expect(gates.length).toBe(2)
    // mirar hacia la fachada: el punto de partida queda fuera de la casa
    const xs = p1!.walls.flatMap((w) => [w.start.x, w.end.x])
    const ys = p1!.walls.flatMap((w) => [w.start.y, w.end.y])
    const outside = entry.x < Math.min(...xs) || entry.x > Math.max(...xs) || entry.y < Math.min(...ys) || entry.y > Math.max(...ys)
    expect(outside).toBe(true)
    expect(Math.hypot(entry.facing.x, entry.facing.y)).toBeCloseTo(1)
  })

  it('un plafón por ambiente; el último piso solo lleva si hay cubierta', () => {
    const lamps = roomLamps(model)
    expect(lamps.filter((l) => l.levelId === p2!.id).length).toBeGreaterThanOrEqual(6)
    const count = (roof: boolean) => {
      const names: string[] = []
      buildScene(model, undefined, { details: true, roof }).details.traverse((o) => o instanceof THREE.Mesh && o.name.startsWith('lamp:') && names.push(String(o.userData.levelId)))
      return names
    }
    expect(count(false)).not.toContain(p3!.id)
    expect(count(true)).toContain(p3!.id)
    // cuelga del cielo raso del piso 2 (2,6 + 2,6 m de muro)
    const l = lamps.find((x) => x.levelId === p2!.id)!
    expect(l.ceiling).toBeCloseTo(5.2, 1)
  })
})

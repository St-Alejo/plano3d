import { describe, expect, it } from 'vitest'
import { door, rect, wall, windowOp } from '@/test/fixtures'
import { obstaclesFromWalls, resolveCollision } from './collision'
import {
  boxVolume,
  curvedWallBoxes,
  doorLeaf,
  roomShapePoints,
  stairSteps,
  tourWaypoints,
  wallAxis,
  wallToBoxes,
} from './geometry'

const T = 0.2
const H = 2.6

describe('wallToBoxes', () => {
  it('muro sin aberturas: un bloque alargado medio grosor en cada punta', () => {
    const boxes = wallToBoxes(wall('w', 0, 0, 4, 0))
    expect(boxes).toHaveLength(1)
    boxes[0]!.size.forEach((v, i) => expect(v).toBeCloseTo([4 + T, H, T][i]!))
    boxes[0]!.center.forEach((v, i) => expect(v).toBeCloseTo([2, H / 2, 0][i]!))
  })

  it('puerta: dos tramos + dintel, sin nada bajo la puerta', () => {
    const boxes = wallToBoxes(wall('w', 0, 0, 4, 0, [door('d', 1, 1)]))
    expect(boxes.map((b) => b.part)).toEqual(['solid', 'lintel', 'solid'])
    const lintel = boxes[1]!
    expect(lintel.size[1]).toBeCloseTo(H - 2.1)
    expect(lintel.center[1]).toBeCloseTo((2.1 + H) / 2)
  })

  it('ventana: tramos + antepecho + dintel', () => {
    const boxes = wallToBoxes(wall('w', 0, 0, 4, 0, [windowOp('v', 1, 1.2)]))
    expect(boxes.map((b) => b.part)).toEqual(['solid', 'sill', 'lintel', 'solid'])
  })

  it.each([
    ['sin aberturas', []],
    ['una puerta', [door('d', 1, 1)]],
    ['puerta y ventana', [door('d', 0.5, 0.9), windowOp('v', 2.2, 1.2)]],
    ['abertura pegada al inicio', [door('d', 0, 0.9)]],
  ])('volumen = macizo - huecos (%s)', (_n, openings) => {
    const w = wall('w', 1, 1, 5, 1, openings)
    const solid = (4 + T) * H * T
    const holes = openings.reduce((s, o) => s + o.width * o.height * T, 0)
    const vol = wallToBoxes(w).reduce((s, b) => s + boxVolume(b), 0)
    expect(vol).toBeCloseTo(solid - holes, 9)
  })

  it('los bloques de un muro nunca se solapan a lo largo del muro', () => {
    const w = wall('w', 0, 0, 6, 0, [door('d', 0.5), windowOp('v', 2), door('e', 4.5, 1)])
    const spans = wallToBoxes(w)
      .filter((b) => b.part === 'solid')
      .map((b) => [b.center[0] - b.size[0] / 2, b.center[0] + b.size[0] / 2] as const)
    for (let i = 1; i < spans.length; i++) expect(spans[i]![0]).toBeGreaterThanOrEqual(spans[i - 1]![1] - 1e-9)
  })

  it('orienta el bloque según la dirección del muro', () => {
    const [b] = wallToBoxes(wall('w', 0, 0, 0, 5))
    expect(b!.rotationY).toBeCloseTo(-Math.PI / 2)
    expect(b!.center[0]).toBeCloseTo(0)
    expect(b!.center[2]).toBeCloseTo(2.5)
  })
})

describe('pisos y recorrido', () => {
  it('el contorno del ambiente niega y para la rotación del Shape', () => {
    expect(roomShapePoints(rect('r', 'x', 1, 2, 3, 4))[0]).toEqual([1, -2])
  })
  it('puntos de paso en orden natural de nombre', () => {
    const wp = tourWaypoints([rect('b', 'Espacio 10', 0, 0, 2, 2), rect('a', 'Espacio 2', 4, 0, 6, 2)])
    expect(wp.map((w) => w.label)).toEqual(['Espacio 2', 'Espacio 10'])
    expect(wp[0]!.at).toEqual({ x: 5, y: 1 })
  })
})

describe('colisión del modo Recorrer', () => {
  const walls = [wall('w', 0, 0, 10, 0, [door('d', 4, 1)]), wall('v', 0, 0, 0, 10)]
  const obstacles = obstaclesFromWalls(walls)
  const R = 0.3

  it('los dinteles no bloquean (se puede pasar bajo la puerta)', () => {
    expect(obstacles).toHaveLength(3) // 2 tramos del muro con puerta + muro vertical
  })

  it('empuja fuera de un muro a distancia = radio', () => {
    const p = resolveCollision({ x: 2, y: 0.2 }, obstacles, R)
    expect(p.x).toBeCloseTo(2)
    expect(p.y).toBeCloseTo(T / 2 + R)
  })

  it('deja pasar por el hueco de la puerta', () => {
    expect(resolveCollision({ x: 4.5, y: 0 }, obstacles, R)).toEqual({ x: 4.5, y: 0 })
  })

  it('no modifica posiciones libres', () => {
    expect(resolveCollision({ x: 5, y: 5 }, obstacles, R)).toEqual({ x: 5, y: 5 })
  })

  it('saca el centro si quedó dentro del muro', () => {
    const p = resolveCollision({ x: 2, y: 0.01 }, obstacles, R)
    expect(Math.abs(p.y)).toBeGreaterThanOrEqual(T / 2 + R - 1e-9)
  })

  it('en una esquina resuelve ambos muros', () => {
    const p = resolveCollision({ x: 0.2, y: 0.2 }, obstacles, R)
    expect(p.x).toBeGreaterThanOrEqual(T / 2 + R - 1e-6)
    expect(p.y).toBeGreaterThanOrEqual(T / 2 + R - 1e-6)
  })

  it('funciona con muros diagonales (propiedad: nunca queda a menos de R)', () => {
    const diag = obstaclesFromWalls([wall('d', 0, 0, 5, 5)])
    for (let i = 0; i < 100; i++) {
      const t = Math.random() * 5
      const off = (Math.random() - 0.5) * 0.6
      const p = resolveCollision({ x: t - off, y: t + off }, diag, R)
      // distancia a la recta y = x
      const d = Math.abs(p.x - p.y) / Math.SQRT2
      expect(d).toBeGreaterThanOrEqual(T / 2 + R - 1e-6)
    }
  })
})

describe('dirección inicial del recorrido', () => {
  it('mira hacia donde hay más espacio libre', async () => {
    const { bestViewAngle, freeDistance, obstaclesFromWalls: obs } = await import('./collision')
    // pasillo: muro cerca al norte (y=-1) y al oeste (x=-1), campo libre hacia el este
    const o = obs([wall('n', -5, -1, 20, -1), wall('w', -1, -5, -1, 5), wall('s', -5, 1, 20, 1)])
    expect(freeDistance({ x: 0, y: 0 }, -Math.PI / 2, o)).toBeLessThan(1)
    const a = bestViewAngle({ x: 0, y: 0 }, o)
    expect(Math.cos(a)).toBeGreaterThan(0.9) // hacia +x
  })
})

describe('modelo v2 en 3D', () => {
  const base = { id: 'w', thickness: 0.2, height: 2.6, material: 'x', openings: [], confidence: 1 }

  it('el eje de un muro curvo pasa por sus extremos y por la flecha', () => {
    const pts = wallAxis({ start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, bulge: 1 })
    expect(pts[0]!.x).toBeCloseTo(0)
    expect(pts.at(-1)!.x).toBeCloseTo(4)
    const mid = pts[Math.floor(pts.length / 2)]!
    // flecha positiva = normal izquierda de (1,0) en imagen = (0, 1)
    expect(mid.y).toBeCloseTo(1, 1)
    expect(wallAxis({ start: { x: 0, y: 0 }, end: { x: 4, y: 0 } })).toHaveLength(2)
  })

  it('un muro curvo se arma con varios bloques sobre el arco', () => {
    const w = { ...base, start: { x: 0, y: 0 }, end: { x: 0, y: 3 }, bulge: -1.2 }
    const boxes = curvedWallBoxes(w as never)
    expect(boxes.length).toBeGreaterThan(5)
    const maxX = Math.max(...boxes.map((b) => b.center[0]))
    expect(maxX).toBeGreaterThan(1.0) // sobresale ~1,2 m hacia +x
  })

  it('peldaños: uno por huella, subiendo de a una contrahuella', () => {
    const steps = stairSteps({ start: { x: 0, y: 0 }, end: { x: 3, y: 0 }, width: 1, steps: 12, riser: 0.175 })
    expect(steps).toHaveLength(12)
    expect(steps.at(-1)!.size[1]).toBeCloseTo(2.1)
    expect(steps[0]!.size[0]).toBeCloseTo(0.25)
  })

  it('la hoja de la puerta gira sobre su bisagra hacia el lado que abre', () => {
    const w = { start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: 0.15 }
    const left = doorLeaf(w, { offset: 1, width: 0.9, height: 2.1, opens_left: true })
    const right = doorLeaf(w, { offset: 1, width: 0.9, height: 2.1, opens_left: false })
    expect(Math.sign(left.center[2])).toBe(-Math.sign(right.center[2]))
    expect(left.center[0]).toBeGreaterThan(1)
    expect(left.center[0]).toBeLessThan(1.9)
  })
})

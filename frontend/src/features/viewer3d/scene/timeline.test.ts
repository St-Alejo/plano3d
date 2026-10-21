import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { deriveStructure } from '@/domain/structure/derive'
import { masonryLayout } from '@/domain/structure/masonryLayout'
import { constructionSchedule, STEP } from '@/domain/structure/schedule'
import { sampleModel } from '@/test/fixtures'
import { secuencia } from '../modes'
import { MaterialFactory } from './MaterialFactory'
import { stepProgress, stepTimeline } from './timeline'

const model = sampleModel()
const s = deriveStructure(model)
const steps = constructionSchedule(model, s, masonryLayout(model, s)).map((x) => x.id)
const level = model.levels[0]!.id

const byStep = (root: THREE.Object3D, step: string) => {
  const out: THREE.Mesh[] = []
  root.traverse((o) => o instanceof THREE.Mesh && o.userData.step === step && out.push(o))
  return out
}

describe('línea de tiempo de la obra', () => {
  it('cada malla de la escena de secuencia pertenece a un paso del cronograma', () => {
    const scene = secuencia.build(model, new MaterialFactory())
    const tagged = new Set<string>()
    scene.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      expect(o.userData.step, o.name).toBeTruthy()
      tagged.add(o.userData.step as string)
    })
    for (const step of tagged) expect(steps).toContain(step)
  })

  it('a mitad de los muros: la cimentación hecha, la mitad de las hiladas, sin columnetas', () => {
    const scene = secuencia.build(model, new MaterialFactory())
    const walls = steps.indexOf(STEP.muros(level))
    stepTimeline(scene.root, steps, walls + 0.5)
    for (const m of byStep(scene.root, STEP.cimentacion)) {
      expect(m.visible).toBe(true)
      expect(m.scale.y).toBe(1)
    }
    for (const m of byStep(scene.root, STEP.columnas(level))) expect(m.visible).toBe(false)
    const bricks = byStep(scene.root, STEP.muros(level)).filter((m): m is THREE.InstancedMesh => m instanceof THREE.InstancedMesh)
    const shown = bricks.reduce((a, m) => a + m.count, 0)
    const total = bricks.reduce((a, m) => a + (m.userData.bottoms as number[]).length, 0)
    expect(shown).toBeGreaterThan(total * 0.2)
    expect(shown).toBeLessThan(total * 0.8)
    // las primeras instancias son las de abajo: las hiladas suben
    const first = bricks[0]!
    const bottoms = first.userData.bottoms as number[]
    expect([...bottoms].sort((a, b) => a - b)).toEqual(bottoms)
  })

  it('el concreto se llena desde el fondo y se puede retroceder', () => {
    const scene = secuencia.build(model, new MaterialFactory())
    const i = steps.indexOf(STEP.cimentacion)
    const footing = byStep(scene.root, STEP.cimentacion)[0]!
    const full = footing.position.y
    const height = (footing.geometry as THREE.BoxGeometry).parameters.height
    stepTimeline(scene.root, steps, i + 0.5)
    expect(footing.scale.y).toBeCloseTo(0.5)
    // el fondo no se mueve: baja el centro la mitad de lo que falta
    expect(footing.position.y - (height * footing.scale.y) / 2).toBeCloseTo(full - height / 2)
    stepTimeline(scene.root, steps, i)
    expect(footing.visible).toBe(false)
    stepTimeline(scene.root, steps, steps.length)
    expect(footing.visible).toBe(true)
    expect(footing.position.y).toBeCloseTo(full)
  })

  it('stepProgress', () => {
    expect(stepProgress(3, 2.5)).toBe(0)
    expect(stepProgress(3, 3.25)).toBe(0.25)
    expect(stepProgress(3, 9)).toBe(1)
  })
})

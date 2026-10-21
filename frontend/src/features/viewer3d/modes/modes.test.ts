import { describe, expect, it } from 'vitest'
import { sampleModel } from '@/test/fixtures'
import { MaterialFactory } from '../scene/MaterialFactory'
import { buildScene, disposeScene } from '../scene/SceneBuilder'
import { PLAN_MODES, planMode, presentacion } from '.'

const names = (s: ReturnType<typeof buildScene>) => {
  const out: string[] = []
  s.root.traverse((o) => out.push(o.name))
  return out
}

describe('modos del plano', () => {
  it('presentación arma exactamente la escena de siempre', () => {
    const a = presentacion.build(sampleModel(), new MaterialFactory())
    const b = buildScene(sampleModel())
    expect(names(a)).toEqual(names(b))
    disposeScene(a)
    disposeScene(b)
  })

  it('un id desconocido o vacío cae en presentación', () => {
    expect(planMode('nada').id).toBe('presentacion')
    expect(planMode(null).id).toBe('presentacion')
  })

  it('los ids registrados son únicos y se resuelven a sí mismos', () => {
    const ids = PLAN_MODES.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(planMode(id).id).toBe(id)
  })
})

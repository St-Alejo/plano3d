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
  it('presentación es la escena de siempre; en calidad alta suma detalles y terreno', () => {
    const plain = presentacion.build(sampleModel(), new MaterialFactory())
    expect(names(plain)).toEqual(names(buildScene(sampleModel())))
    const real = presentacion.build(sampleModel(), new MaterialFactory(), { realism: true, roof: true })
    expect(names(real)).toEqual(names(buildScene(sampleModel(), undefined, { details: true, site: true, roof: true })))
    disposeScene(plain)
    disposeScene(real)
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

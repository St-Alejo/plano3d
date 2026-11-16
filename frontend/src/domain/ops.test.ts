import { describe, expect, it } from 'vitest'
import type { BuildingModel } from '@/api/types'
import cases from './__fixtures__/ops-cases.json'
import opc3 from '@/test/opc3.json'
import { applyOps, canonical, diffModels, InvalidOpError, type ModelOp } from './ops'

type Case = { name: string; check: string[]; before: unknown; ops: unknown[]; after: unknown }
const all = cases.cases as Case[]
const model = (x: unknown) => x as BuildingModel
const opsOf = (x: unknown[]) => x as ModelOp[]

describe('contrato de ops (casos compartidos con el backend y el escritorio)', () => {
  it.each(all.filter((c) => c.check.includes('apply')).map((c) => [c.name, c] as const))('apply: %s', (_, c) => {
    expect(canonical(applyOps(model(c.before), opsOf(c.ops)))).toEqual(canonical(c.after))
  })

  it.each(all.filter((c) => c.check.includes('diff')).map((c) => [c.name, c] as const))('diff: %s', (_, c) => {
    expect(diffModels(model(c.before), model(c.after))).toEqual(c.ops)
  })

  it.each(cases.errors.map((c) => [c.name, c] as const))('rechaza: %s', (_, c) => {
    expect(() => applyOps(model(c.before), opsOf(c.ops))).toThrow(InvalidOpError)
  })
})

describe('ops sobre la casa de 3 pisos', () => {
  const house = opc3 as unknown as BuildingModel

  it('no ve cambios entre el modelo y su copia', () => {
    expect(diffModels(house, structuredClone(house))).toEqual([])
  })

  it('diff y apply hacen ida y vuelta al mover un muro y borrar un ambiente', () => {
    const edited = structuredClone(house)
    const lv = edited.levels[1]!
    const w = lv.walls[0]!
    w.end = { x: w.end.x + 0.25, y: w.end.y }
    lv.rooms = lv.rooms.slice(1)
    const ops = diffModels(house, edited)
    expect(ops.map((o) => `${o.t} ${o.k}`).sort()).toEqual(['del room', 'put wall'])
    // lo aplicado y lo editado solo difieren en los campos que recalcula el servidor (largo, área)
    expect(diffModels(applyOps(house, ops), edited)).toEqual([])
  })

  it('no modifica el modelo original', () => {
    const before = JSON.stringify(house)
    applyOps(house, [{ t: 'del', k: 'level', id: house.levels[0]!.id }])
    expect(JSON.stringify(house)).toBe(before)
  })
})

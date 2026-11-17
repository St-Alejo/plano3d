import { describe, expect, it } from 'vitest'
import type { BuildingModel } from '@/api/types'
import opc3 from '@/test/opc3.json'
import { describeLevel, findCatalogItem } from './planOps'

describe('findCatalogItem: palabras de la gente', () => {
  it.each(['televisor', 'un televisor', 'Televisión', 'tele', 'TV', 'pantalla grande'])('«%s» → mueble de TV', (text) => {
    expect(findCatalogItem(text).id).toBe('mueble_tv')
  })

  it('lo que no está sigue explicándose', () => {
    expect(() => findCatalogItem('jacuzzi')).toThrow(/No tengo «jacuzzi»/)
  })
})

describe('describeLevel: lo que ve la IA', () => {
  it('dice qué lados de cada ambiente son muro exterior', () => {
    const level = (opc3 as unknown as BuildingModel).levels.find((l) => l.rooms.length > 0)!
    const text = describeLevel(level)
    expect(text).toMatch(/muros exteriores: (norte|sur|este|oeste)/)
    // ningún ambiente tiene más de 4 lados exteriores y el resumen sigue terminando con los muros
    expect(text.split('\n').at(-1)).toMatch(/^Muros: espesor/)
  })
})

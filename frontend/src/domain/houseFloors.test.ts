import { describe, expect, it } from 'vitest'
import { floorNumber, houseName, orderFloors } from './houseFloors'

const f = (name: string) => ({ name })

describe('floorNumber', () => {
  it('lee el piso del nombre del archivo o del rótulo', () => {
    expect(floorNumber('piso-2.png')).toBe(2)
    expect(floorNumber('Planta_3.pdf')).toBe(3)
    expect(floorNumber('casa p4.jpg')).toBe(4)
    expect(floorNumber('Tercer piso')).toBe(3)
    expect(floorNumber('planta baja.png')).toBe(1)
    expect(floorNumber('Sótano.png')).toBe(0)
    expect(floorNumber('azotea.png')).toBeGreaterThan(10)
    expect(floorNumber('2.png')).toBe(2)
    expect(floorNumber('IMG_20261116_1430.jpg')).toBeNull()
    expect(floorNumber('fachada.png')).toBeNull()
  })
})

describe('orderFloors', () => {
  it('ordena de abajo hacia arriba por el número leído', () => {
    const out = orderFloors([f('piso-3.png'), f('piso-1.png'), f('piso-2.png')])
    expect(out.map((x) => x.file.name)).toEqual(['piso-1.png', 'piso-2.png', 'piso-3.png'])
    expect(out.map((x) => x.name)).toEqual(['Piso 1', 'Piso 2', 'Piso 3'])
  })

  it('sin rótulos respeta el orden de subida; los sin número van encima de los reconocidos', () => {
    expect(orderFloors([f('a.jpg'), f('b.jpg')]).map((x) => x.file.name)).toEqual(['a.jpg', 'b.jpg'])
    expect(orderFloors([f('foto.jpg'), f('piso-1.png')]).map((x) => x.file.name)).toEqual(['piso-1.png', 'foto.jpg'])
  })

  it('sótano y azotea conservan su nombre y el sótano no corre la numeración', () => {
    const out = orderFloors([f('azotea.png'), f('piso-1.png'), f('sotano.png')])
    expect(out.map((x) => x.name)).toEqual(['Sótano', 'Piso 1', 'Azotea'])
  })
})

it('houseName usa lo escrito o la cantidad de pisos', () => {
  expect(houseName('  Casa Mirador ', 4)).toBe('Casa Mirador')
  expect(houseName('', 3)).toBe('Casa de 3 pisos')
  expect(houseName('', 1)).toBe('Casa de 1 piso')
})

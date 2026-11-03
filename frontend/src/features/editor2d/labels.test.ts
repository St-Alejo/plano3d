import { describe, expect, it } from 'vitest'
import { fitRoomLabel, placeLabels, rotatedBox } from './labels'

describe('rótulo del ambiente', () => {
  it('en un ambiente ancho va a tamaño normal y con el área', () => {
    expect(fitRoomLabel('Hall', '17.3 m²', 200, 120, 13)).toMatchObject({ fontSize: 13, showArea: true })
  })

  it('en uno angosto achica la letra sin partir «Parqueadero» a la mitad', () => {
    const fit = fitRoomLabel('Parqueadero 2', '22.2 m²', 80, 200, 13)!
    expect(fit.fontSize).toBeLessThan(13)
    // la palabra más larga cabe entera en el ancho del rótulo
    expect('Parqueadero'.length * fit.fontSize * 0.6).toBeLessThanOrEqual(fit.width)
    expect(fit.width).toBeLessThanOrEqual(80)
  })

  it('si no cabe en alto quita el área, y si no cabe nada no lo pone', () => {
    expect(fitRoomLabel('Baño', '1.8 m²', 60, 28, 13)).toMatchObject({ showArea: false })
    expect(fitRoomLabel('Parqueadero 2', '22.2 m²', 30, 200, 13)).toBeNull()
    expect(fitRoomLabel('Baño', '1.8 m²', 60, 8, 13)).toBeNull()
  })
})

describe('cotas sin encimarse', () => {
  it('de dos cotas que chocan queda la de mayor prioridad (el muro más largo)', () => {
    const a = { box: rotatedBox(100, 100, 30, 11, 90), priority: 4.39 }
    const b = { box: rotatedBox(104, 104, 30, 11, 90), priority: 4.0 }
    const c = { box: rotatedBox(300, 100, 30, 11, 0), priority: 2.94 }
    expect(placeLabels([b, a, c])).toEqual([false, true, true])
  })

  it('no se pone una cota encima del rótulo de un ambiente', () => {
    const room = { x: 90, y: 90, w: 40, h: 30 }
    expect(placeLabels([{ box: rotatedBox(100, 100, 30, 11, 0), priority: 1 }], [room])).toEqual([false])
  })

  it('una caja girada 90° intercambia ancho y alto', () => {
    const b = rotatedBox(0, 0, 30, 10, 90)
    expect(b.w).toBeCloseTo(10)
    expect(b.h).toBeCloseTo(30)
  })
})

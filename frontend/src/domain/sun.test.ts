import { describe, expect, it } from 'vitest'
import { BOGOTA, sunDirection, sunPosition } from './sun'

describe('sunPosition (Bogotá)', () => {
  it('equinoccio a mediodía solar: casi vertical, apenas al sur', () => {
    // mediodía solar en Bogotá ≈ 11:56 hora local en marzo
    const s = sunPosition({ year: 2026, month: 3, day: 20, hour: 11.95 })
    expect(s.altitude).toBeGreaterThan(84)
    expect(s.altitude).toBeLessThan(86.5)
  })

  it('sale por el oriente y se pone por el occidente', () => {
    const morning = sunPosition({ year: 2026, month: 3, day: 20, hour: 7 })
    const evening = sunPosition({ year: 2026, month: 3, day: 20, hour: 17 })
    expect(morning.altitude).toBeGreaterThan(0)
    expect(morning.azimuth).toBeGreaterThan(80)
    expect(morning.azimuth).toBeLessThan(100)
    expect(evening.azimuth).toBeGreaterThan(260)
    expect(evening.azimuth).toBeLessThan(280)
    expect(sunPosition({ year: 2026, month: 3, day: 20, hour: 0 }).altitude).toBeLessThan(0)
  })

  it('en junio el sol de mediodía va al norte; en diciembre, al sur', () => {
    const june = sunPosition({ year: 2026, month: 6, day: 21, hour: 12 })
    const dec = sunPosition({ year: 2026, month: 12, day: 21, hour: 12 })
    expect(Math.cos((june.azimuth * Math.PI) / 180)).toBeGreaterThan(0) // hacia el norte
    expect(Math.cos((dec.azimuth * Math.PI) / 180)).toBeLessThan(0) // hacia el sur
    expect(june.altitude).toBeCloseTo(90 - (23.44 - BOGOTA.lat), 0)
  })

  it('la dirección en la escena es unitaria y apunta arriba de día', () => {
    const d = sunDirection({ altitude: 30, azimuth: 90 })
    expect(Math.hypot(...d)).toBeCloseTo(1)
    expect(d[0]).toBeGreaterThan(0.8) // este = +x
    expect(d[1]).toBeCloseTo(0.5)
  })
})

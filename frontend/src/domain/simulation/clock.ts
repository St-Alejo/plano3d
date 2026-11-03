/**
 * Reloj del día en la simulación: una hora pasa en `SECONDS_PER_HOUR` segundos (a velocidad 1)
 * y el sol sigue la posición real de Bogotá para esa hora (`sunPosition`).
 */
import { sunPosition, type SunPosition } from '../sun'

export const SECONDS_PER_HOUR = 20
/** el sol más bajo que esto (grados) ya es noche: se prenden las luces */
export const NIGHT_ALTITUDE = 4

export function advanceHour(hour: number, dt: number, speed = 1): number {
  const h = hour + (dt * speed) / SECONDS_PER_HOUR
  return ((h % 24) + 24) % 24
}

/** Fecha fija (equinoccio de marzo): el día dura ~12 h, de 6 a 18. */
export function sunAt(hour: number): SunPosition {
  return sunPosition({ year: 2026, month: 3, day: 20, hour })
}

export function isNight(hour: number): boolean {
  return sunAt(hour).altitude < NIGHT_ALTITUDE
}

/** "07:30" */
export function clockLabel(hour: number): string {
  const h = Math.floor(hour)
  const m = Math.floor((hour - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

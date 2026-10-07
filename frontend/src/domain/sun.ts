/**
 * Posición del sol (aproximación de la NOAA, error < 1°): suficiente para estudiar
 * asoleamiento y sombras en un modelo arquitectónico. Bogotá por defecto.
 */

export const BOGOTA = { lat: 4.711, lon: -74.072, utcOffset: -5 }

export interface SunPosition {
  /** grados sobre el horizonte (negativo = de noche) */
  altitude: number
  /** grados desde el norte, en sentido horario (90 = este) */
  azimuth: number
}

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

function dayOfYear(year: number, month: number, day: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86_400_000)
}

/**
 * @param hour hora local en decimal (14.5 = 2:30 p. m.) en la zona `utcOffset`
 */
export function sunPosition(
  { year, month, day, hour }: { year: number; month: number; day: number; hour: number },
  place: { lat: number; lon: number; utcOffset: number } = BOGOTA,
): SunPosition {
  const n = dayOfYear(year, month, day)
  const g = ((2 * Math.PI) / 365) * (n - 1 + (hour - 12) / 24)
  const eqTime =
    229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g)
  const trueSolarMin = hour * 60 + eqTime + 4 * place.lon - 60 * place.utcOffset
  const hourAngle = rad(trueSolarMin / 4 - 180)
  const lat = rad(place.lat)
  const cosZen = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle)
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZen)))
  const az = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat))
  return { altitude: 90 - deg(zenith), azimuth: (deg(az) + 180 + 360) % 360 }
}

/**
 * Dirección hacia el sol en la escena (x = este, y = arriba, z = sur), suponiendo que el
 * norte del plano está hacia arriba de la hoja (−y del plano = −z de la escena).
 * `northDeg` gira el norte si el plano no está orientado así.
 */
export function sunDirection(sun: SunPosition, northDeg = 0): [number, number, number] {
  const alt = rad(sun.altitude)
  const az = rad(sun.azimuth - northDeg)
  return [Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az)]
}

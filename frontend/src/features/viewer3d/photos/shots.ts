/**
 * Las tomas de las fotos con IA: de dónde se captura el modelo para cada foto.
 *
 * Cuatro capturas dan cinco fotos: la de la calle se usa dos veces (de día y de noche),
 * así la IA recibe la misma geometría y solo cambia la hora.
 */
import type { BuildingModel, Room } from '@/api/types'
import { modelBounds, roomArea, type Bounds } from '@/domain/model'
import { buildingHeight, cameraPreset, fitFraming } from '../scene/viewTools'
import type { Shot } from '../Viewer3D'

export type PhotoView = 'calle' | 'esquina' | 'costado' | 'noche' | 'interior'

/** Vistas en el orden en que se muestran, con su rótulo. */
export const PHOTO_VIEWS: { view: PhotoView; label: string }[] = [
  { view: 'calle', label: 'Desde la calle' },
  { view: 'esquina', label: 'Al atardecer' },
  { view: 'costado', label: 'Desde el otro costado' },
  { view: 'noche', label: 'De noche' },
  { view: 'interior', label: 'Por dentro' },
]

/** Las capturas son 3:2 (1200×800) y se enmarcan para ese formato. */
const ASPECT = 1.5
const FOV = 50
const INTERIOR_FOV = 68

const vec = (v: [number, number, number]): [number, number, number] => [v[0], v[1], v[2]]

/** El ambiente que mejor se ve por dentro: la sala o la cocina; si no, el más grande habitable. */
export function showcaseRoom(model: BuildingModel): { room: Room; elevation: number } | null {
  const skip = /parqueader|garaj|ba[ñn]o|escaler|pasillo|patio|ropa|deposito|depósito|hall/i
  const prefer = /sala|comedor|cocina|estar/i
  let best: { room: Room; elevation: number; score: number } | null = null
  for (const lv of model.levels) {
    for (const room of lv.rooms) {
      const name = room.label
      if (room.polygon.length < 3 || skip.test(name)) continue
      const score = roomArea(room) * (prefer.test(name) ? 3 : 1)
      if (!best || score > best.score) best = { room, elevation: lv.elevation, score }
    }
  }
  return best && { room: best.room, elevation: best.elevation }
}

/** Toma de interior: desde la esquina del ambiente más cercana al centro de la casa, mirando a la opuesta. */
function interiorShot(model: BuildingModel): Shot | null {
  const pick = showcaseRoom(model)
  if (!pick) return null
  const { room, elevation } = pick
  const xs = room.polygon.map((p) => p.x)
  const ys = room.polygon.map((p) => p.y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const center = modelBounds(model).center
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  // la esquina del lado del centro de la casa: así se mira hacia la fachada, donde están las ventanas
  const sx = center.x <= cx ? -1 : 1
  const sy = center.y <= cy ? -1 : 1
  const inset = 0.7
  const pos: [number, number, number] = [cx + sx * ((maxX - minX) / 2 - inset), elevation + 1.45, cy + sy * ((maxY - minY) / 2 - inset)]
  const look: [number, number, number] = [cx - sx * (maxX - minX) * 0.5, elevation + 1.15, cy - sy * (maxY - minY) * 0.5]
  return { pos, look, fov: INTERIOR_FOV }
}

/**
 * Toma de la calle: de frente a la fachada y a la altura de los ojos, tan cerca como lo
 * permitan el alto y el ancho de la fachada (el fondo de la casa no cuenta: no se ve).
 */
export function streetShot(b: Bounds, height: number): Shot {
  const vHalf = ((FOV / 2) * Math.PI) / 180
  const hHalf = Math.atan(Math.tan(vHalf) * ASPECT)
  const width = b.maxX - b.minX
  const d = Math.max((height * 0.62) / Math.tan(vHalf), (width * 0.72) / Math.tan(hHalf), 4)
  return { pos: [b.center.x, 1.6, b.maxY + d], look: [b.center.x, height * 0.5, b.maxY], fov: FOV }
}

/** Las tomas de cada vista (la de noche reutiliza la de la calle). */
export function photoShots(model: BuildingModel): { view: PhotoView; shot: Shot }[] {
  const b = modelBounds(model)
  const height = buildingHeight(model)
  const fit = (v: { position: [number, number, number]; target: [number, number, number] }) => {
    const f = fitFraming(v, b, height, ASPECT, FOV)
    return { pos: vec(f.position), look: vec(f.target), fov: FOV }
  }
  const street = streetShot(b, height)
  const corner = fit(cameraPreset('iso', b))
  // del otro lado de la fachada, más bajo: se ve el otro costado sin volar sobre la casa
  const side = fit({
    position: [b.center.x - b.size * 0.75, Math.max(2.5, height * 0.55), b.maxY + b.size * 0.9],
    target: [b.center.x, height * 0.4, b.center.y],
  })
  const shots: { view: PhotoView; shot: Shot }[] = [
    { view: 'calle', shot: street },
    { view: 'esquina', shot: corner },
    { view: 'costado', shot: side },
    { view: 'noche', shot: street },
  ]
  const inside = interiorShot(model)
  if (inside) shots.push({ view: 'interior', shot: inside })
  return shots
}

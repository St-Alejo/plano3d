/**
 * Resumen de los niveles (pisos) de un modelo, para el selector de pisos del visor 3D:
 * nombre, número de piso, altura, área útil, ambientes y caja en planta. Puro: sin three.
 */
import type { BuildingModel, Level } from '@/api/types'
import { polygonCentroid, roomArea } from './model'

/** Altura de entrepiso si el nivel no trae la suya. */
export const DEFAULT_STOREY_HEIGHT = 2.5

export interface LevelBox {
  x0: number
  x1: number
  y0: number
  y1: number
}

export interface LevelSummary {
  id: string
  name: string
  /** 1 = el más bajo */
  number: number
  elevation: number
  height: number
  /** área útil: suma de los ambientes, m² */
  area: number
  rooms: number
  box: LevelBox | null
}

/** Caja envolvente en planta de los muros de un nivel. */
export function levelBox(lv: Level): LevelBox | null {
  if (lv.walls.length === 0) return null
  const xs = lv.walls.flatMap((w) => [w.start.x, w.end.x])
  const ys = lv.walls.flatMap((w) => [w.start.y, w.end.y])
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

/** Niveles ordenados de abajo hacia arriba, con su resumen. */
export function levelSummaries(model: BuildingModel): LevelSummary[] {
  return [...model.levels]
    .sort((a, b) => a.elevation - b.elevation)
    .map((lv, i) => ({
      id: lv.id,
      name: lv.name,
      number: i + 1,
      elevation: lv.elevation,
      height: lv.height ?? DEFAULT_STOREY_HEIGHT,
      area: lv.rooms.reduce((sum, r) => sum + roomArea(r), 0),
      rooms: lv.rooms.length,
      box: levelBox(lv),
    }))
}

/** Ids de los niveles que quedan por encima de `id` (los que se ocultan al aislar ese piso). */
export function levelsAbove(model: BuildingModel, id: string): string[] {
  const all = levelSummaries(model)
  const at = all.find((l) => l.id === id)
  return at ? all.filter((l) => l.elevation > at.elevation).map((l) => l.id) : []
}

/** Encuadre de cámara para ver un piso entero desde arriba en diagonal, como una maqueta. */
export function levelCamera(summary: LevelSummary): { look: [number, number, number]; pos: [number, number, number] } | null {
  const b = summary.box
  if (!b) return null
  const cx = (b.x0 + b.x1) / 2
  const cz = (b.y0 + b.y1) / 2
  const size = Math.max(b.x1 - b.x0, b.y1 - b.y0, 4)
  const y = summary.elevation
  return { look: [cx, y + 0.5, cz], pos: [cx + size * 0.55, y + size * 0.95, cz + size * 0.85] }
}

export interface RoomLamp {
  roomId: string
  levelId: string
  label: string
  x: number
  y: number
  /** altura absoluta del cielo raso donde cuelga el plafón */
  ceiling: number
}

/**
 * Un plafón en el centro de cada ambiente, pegado al cielo raso (el alto de los muros del
 * piso). Lo usan la escena (la lámpara) y el visor (la luz del piso donde se camina).
 */
export function roomLamps(model: BuildingModel): RoomLamp[] {
  return model.levels.flatMap((lv) => {
    const ceiling = lv.elevation + (lv.walls.length ? Math.max(...lv.walls.map((w) => w.height)) : (lv.height ?? DEFAULT_STOREY_HEIGHT))
    return lv.rooms
      .filter((r) => r.polygon.length >= 3 && roomArea(r) >= 1.5)
      .map((r) => {
        const c = polygonCentroid(r.polygon)
        return { roomId: r.id, levelId: lv.id, label: r.label, x: c.x, y: c.y, ceiling }
      })
  })
}

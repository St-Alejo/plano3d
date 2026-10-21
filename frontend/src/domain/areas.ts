/**
 * Cuadro de áreas: ambientes con su tipo, área y perímetro, más el total útil.
 * Lógica pura; la interfaz lo muestra, lo exporta a CSV y lo imprime.
 */
import type { Level, Point, RoomType } from '@/api/types'
import { csv, csvCell, csvNum } from './csv'
import { roomArea } from './model'

export const ROOM_TYPE_LABEL: Record<RoomType, string> = {
  bedroom: 'Alcoba',
  bathroom: 'Baño',
  kitchen: 'Cocina',
  living: 'Sala / comedor',
  study: 'Estudio',
  circulation: 'Circulación',
  patio: 'Patio / terraza',
  laundry: 'Zona de ropas',
  storage: 'Depósito',
  garage: 'Garaje',
  stairs: 'Escaleras',
  other: 'Otro',
}

export interface AreaRow {
  id: string
  label: string
  type: string
  area: number
  perimeter: number
}

export interface AreaSchedule {
  rows: AreaRow[]
  total: number
}

export function perimeter(points: Point[]): number {
  return points.reduce((s, p, i) => {
    const q = points[(i + 1) % points.length]!
    return s + Math.hypot(q.x - p.x, q.y - p.y)
  }, 0)
}

/** Filas del cuadro, de mayor a menor área. */
export function areaSchedule(level: Level): AreaSchedule {
  const rows = level.rooms
    .map((r) => ({
      id: r.id,
      label: r.label,
      type: r.room_type ? ROOM_TYPE_LABEL[r.room_type] : '—',
      area: roomArea(r),
      perimeter: perimeter(r.polygon),
    }))
    .sort((a, b) => b.area - a.area)
  return { rows, total: rows.reduce((s, r) => s + r.area, 0) }
}

/**
 * CSV separado por punto y coma, con BOM para que Excel respete las tildes.
 * Incluye el porcentaje de cada ambiente y la fila de total.
 */
export function areaCsv(schedule: AreaSchedule): string {
  const head = ['Ambiente', 'Tipo', 'Área (m²)', 'Perímetro (m)', '% del total']
  const rows = schedule.rows.map((r) => [csvCell(r.label), csvCell(r.type), csvNum(r.area), csvNum(r.perimeter), csvNum(schedule.total ? (r.area / schedule.total) * 100 : 0)])
  rows.push(['Área útil total', '', csvNum(schedule.total), '', csvNum(schedule.total ? 100 : 0)])
  return csv(head, rows)
}

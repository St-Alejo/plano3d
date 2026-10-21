/**
 * Cantidades de obra: qué hay que comprar, y para qué paso de la secuencia. Salen de la
 * misma estructura derivada que se ve en 3D (ladrillo pieza por pieza, despiece de acero).
 *
 * Las dosificaciones son las típicas de obra pequeña en Colombia; se verifican con el
 * proveedor y no reemplazan el presupuesto de un profesional.
 */
import type { BuildingModel, Level } from '@/api/types'
import { csv, csvCell, csvNum } from '../csv'
import { stairWell } from '../geometry'
import { distance, roomArea } from '../model'
import { brickOf, type LinearElement, type Structure } from './derive'
import type { Brick } from './masonryLayout'
import { BARS, NSR10, type BarNo } from './nsr10'
import { barWeight, rebarSchedule } from './rebar'
import { STEP } from './schedule'

/** Por m³: bultos de cemento de 50 kg, arena y grava en m³. */
interface Mix {
  name: string
  cement: number
  sand: number
  gravel: number
}

export const MIXES = {
  /** concreto de 3000 psi (21 MPa), 1:2:3 */
  concrete: { name: 'Concreto 3000 psi (1:2:3)', cement: 7, sand: 0.56, gravel: 0.84 },
  /** concreto pobre del solado, 1:3:5 */
  lean: { name: 'Concreto pobre (1:3:5)', cement: 4.5, sand: 0.6, gravel: 0.9 },
  /** mortero de pega 1:4 */
  mortar: { name: 'Mortero de pega (1:4)', cement: 7, sand: 1.1, gravel: 0 },
} satisfies Record<string, Mix>

/** Concreto ciclópeo: 60 % concreto y 40 % piedra rajón. */
const CYCLOPEAN_STONE = 0.4

export interface Waste {
  brick: number
  concrete: number
  mortar: number
  steel: number
}

export const DEFAULT_WASTE: Waste = { brick: 0.05, concrete: 0.05, mortar: 0.1, steel: 0.03 }

export type QuantityUnit = 'und' | 'm³' | 'm²' | 'kg' | 'bultos'

export interface QuantityLine {
  /** paso de la secuencia en que se usa (para comprar por etapa) */
  step: string
  item: string
  unit: QuantityUnit
  amount: number
}

/** Losa de entrepiso: rectángulo que cubre los muros del piso, menos el hueco de la escalera. */
export function upperSlabFootprint(level: Level, below: Level | undefined) {
  if (level.walls.length === 0) return null
  const xs = level.walls.flatMap((w) => [w.start.x, w.end.x])
  const ys = level.walls.flatMap((w) => [w.start.y, w.end.y])
  const rect = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
  const well = stairWell(below?.stairs ?? [])
  const wellArea = well ? (well.maxX - well.minX) * (well.maxY - well.minY) : 0
  return { ...rect, well, area: (rect.x1 - rect.x0) * (rect.y1 - rect.y0) - wellArea }
}

const volume = (e: LinearElement, height = e.height, width = e.width) => distance(e.start, e.end) * width * height

export function quantities(model: BuildingModel, s: Structure, bricks: Brick[], waste: Waste = DEFAULT_WASTE): QuantityLine[] {
  const out: QuantityLine[] = []
  const push = (step: string, item: string, unit: QuantityUnit, amount: number) => amount > 1e-9 && out.push({ step, item, unit, amount })
  /** concreto con sus materiales, más el desperdicio */
  const concrete = (step: string, item: string, m3: number, mix: Mix = MIXES.concrete) => {
    const v = m3 * (1 + waste.concrete)
    push(step, item, 'm³', v)
    push(step, `Cemento (${mix.name})`, 'bultos', v * mix.cement)
    push(step, 'Arena', 'm³', v * mix.sand)
    push(step, 'Grava', 'm³', v * mix.gravel)
  }

  // cimentación
  const lean = s.footings.reduce((a, f) => a + volume(f, NSR10.leanConcrete, f.width + 0.1), 0)
  const trench = s.footings.reduce((a, f) => a + distance(f.start, f.end) * (f.width + 0.1) * (-f.bottom + NSR10.leanConcrete), 0)
  push(STEP.terreno, 'Excavación de zanjas', 'm³', trench)
  concrete(STEP.solado, 'Concreto del solado', lean, MIXES.lean)
  concrete(STEP.cimentacion, 'Concreto de vigas de cimentación', s.footings.reduce((a, f) => a + volume(f), 0))
  const plinth = s.plinths.reduce((a, p) => a + volume(p), 0)
  concrete(STEP.sobrecimiento, 'Concreto del sobrecimiento (ciclópeo)', plinth * (1 - CYCLOPEAN_STONE))
  push(STEP.sobrecimiento, 'Piedra rajón', 'm³', plinth * CYCLOPEAN_STONE)
  push(STEP.sobrecimiento, 'Formaleta del sobrecimiento', 'm²', s.plinths.reduce((a, p) => a + 2 * distance(p.start, p.end) * p.height, 0))

  // placas
  const levels = [...model.levels].sort((a, b) => a.elevation - b.elevation)
  levels.forEach((lv, i) => {
    if (i === 0) {
      const area = lv.rooms.reduce((a, r) => a + roomArea(r), 0)
      concrete(STEP.placa, 'Concreto de la placa de contrapiso', area * NSR10.groundSlab)
      return
    }
    const slab = upperSlabFootprint(lv, levels[i - 1])
    if (!slab) return
    concrete(STEP.losa(lv.id), `Concreto de la losa de ${lv.name}`, slab.area * NSR10.upperSlab)
    push(STEP.losa(lv.id), `Formaleta de la losa de ${lv.name}`, 'm²', slab.area)
  })

  // mampostería: piezas con su desperdicio y el mortero de las juntas
  const unit = brickOf(s)
  const walls = new Map(model.levels.flatMap((l) => l.walls.map((w) => [w.id, w] as const)))
  for (const lv of levels) {
    const mine = bricks.filter((b) => b.levelId === lv.id)
    if (mine.length === 0) continue
    const step = STEP.muros(lv.id)
    push(step, unit.name, 'und', Math.ceil(mine.length * (1 + waste.brick)))
    const mortar = mine.reduce((a, b) => a + ((b.length + unit.joint) * (b.height + unit.joint) - b.length * b.height) * (walls.get(b.wallId)?.thickness ?? unit.width), 0)
    const v = mortar * (1 + waste.mortar)
    push(step, 'Mortero de pega', 'm³', v)
    push(step, `Cemento (${MIXES.mortar.name})`, 'bultos', v * MIXES.mortar.cement)
    push(step, 'Arena', 'm³', v * MIXES.mortar.sand)
  }

  // columnetas y vigas por piso: concreto, formaleta y acero
  const bars = rebarSchedule(s)
  const steel = (step: string, ids: Set<string>) => {
    const kg = new Map<BarNo, number>()
    for (const b of bars.filter((x) => ids.has(x.elementId))) kg.set(b.no, (kg.get(b.no) ?? 0) + barWeight(b))
    let total = 0
    for (const [no, w] of [...kg].sort(([a], [b]) => a - b)) {
      push(step, `Acero ${BARS[no].name}`, 'kg', w * (1 + waste.steel))
      total += w
    }
    // alambre negro para amarrar: del orden del 2 % del peso del acero
    push(step, 'Alambre negro Nº18', 'kg', total * 0.02)
  }
  steel(STEP.aceroCimentacion, new Set(s.footings.map((f) => f.id)))
  for (const lv of levels) {
    const cols = s.columns.filter((c) => c.levelId === lv.id)
    if (cols.length > 0) {
      steel(STEP.aceroColumnas(lv.id), new Set(cols.map((c) => c.id)))
      concrete(STEP.columnas(lv.id), 'Concreto de columnetas', cols.reduce((a, c) => a + c.along * c.across * c.height, 0))
      // la columneta se funde contra el ladrillo: formaleta solo en las dos caras del muro
      push(STEP.columnas(lv.id), 'Formaleta de columnetas', 'm²', cols.reduce((a, c) => a + 2 * c.along * c.height, 0))
    }
    const linear = [...s.beams, ...s.lintels].filter((b) => b.levelId === lv.id)
    if (linear.length > 0) {
      steel(STEP.aceroVigas(lv.id), new Set(linear.map((b) => b.id)))
      concrete(STEP.vigas(lv.id), 'Concreto de vigas de amarre y dinteles', linear.reduce((a, b) => a + volume(b), 0))
      // costados de las vigas; los dinteles además llevan fondo (salvan el vano)
      push(STEP.vigas(lv.id), 'Formaleta de vigas y dinteles', 'm²', linear.reduce((a, b) => a + distance(b.start, b.end) * (2 * b.height + (b.kind === 'lintel' ? b.width : 0)), 0))
    }
  }
  return out
}

/** Totales de la obra completa: un renglón por material y unidad. */
export function quantityTotals(lines: QuantityLine[]): QuantityLine[] {
  const map = new Map<string, QuantityLine>()
  for (const l of lines) {
    const key = `${l.item}|${l.unit}`
    const prev = map.get(key)
    map.set(key, prev ? { ...prev, amount: prev.amount + l.amount } : { ...l, step: '' })
  }
  return [...map.values()]
}

/** Redondeo de compra: unidades y bultos enteros hacia arriba; lo demás con decimales. */
export function buyAmount(l: QuantityLine): number {
  return l.unit === 'und' || l.unit === 'bultos' ? Math.ceil(l.amount - 1e-9) : l.amount
}

/** Cantidades por etapa y totales, para Excel. `stepTitle` da el nombre de cada paso. */
export function quantitiesCsv(lines: QuantityLine[], stepTitle: (id: string) => string): string {
  const fmt = (l: QuantityLine) => (l.unit === 'und' || l.unit === 'bultos' ? String(buyAmount(l)) : csvNum(l.amount))
  const rows = lines.map((l) => [csvCell(stepTitle(l.step)), csvCell(l.item), l.unit, fmt(l)])
  for (const t of quantityTotals(lines)) rows.push(['Total obra', csvCell(t.item), t.unit, fmt(t)])
  return csv(['Etapa', 'Material', 'Unidad', 'Cantidad'], rows)
}

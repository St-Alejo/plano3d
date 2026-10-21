/**
 * Despiece de acero: de cada elemento estructural salen sus barras con forma, largo de
 * corte y cantidad, como en la cartilla que se le entrega al ferretero y al maestro.
 */
import { csv, csvNum } from '../csv'
import { distance } from '../model'
import type { LinearElement, Structure, TieColumn } from './derive'
import { BARS, NSR10, type BarNo, type Reinforcement } from './nsr10'

export type BarShape = 'recta' | 'L' | 'estribo'

export interface Bar {
  /** marca única en el despiece: elemento + tipo */
  mark: string
  elementId: string
  no: BarNo
  shape: BarShape
  /** tramos de la forma en metros (para dibujarla): recta [L]; L [gancho, L, gancho]; estribo [a, b, a, b, gancho] */
  legs: number[]
  /** largo de corte de una barra */
  cutLength: number
  count: number
}

export const barWeight = (b: Bar) => b.cutLength * b.count * BARS[b.no].kgPerM

/** Cuántos estribos caben en `length` con zonas de nudo más densas en los dos extremos. */
export function stirrupCount(length: number, s: Reinforcement['stirrups']): number {
  if (length <= 0) return 0
  const zone = s.nodeSpacing && s.nodeZone ? Math.min(s.nodeZone, length / 2) : 0
  const dense = zone > 0 ? 2 * Math.ceil(zone / s.nodeSpacing! - 1e-9) : 0
  const middle = length - 2 * zone
  return dense + Math.max(0, Math.ceil(middle / s.spacing - 1e-9)) + 1
}

/**
 * Dónde va cada estribo a lo largo de `length` (desde 0): denso en las zonas de nudo y a la
 * separación general en el centro. Da tantas posiciones como `stirrupCount`.
 */
export function stirrupPositions(length: number, s: Reinforcement['stirrups']): number[] {
  if (length <= 0) return []
  const zone = s.nodeSpacing && s.nodeZone ? Math.min(s.nodeZone, length / 2) : 0
  const dense = zone > 0 ? Math.ceil(zone / s.nodeSpacing! - 1e-9) : 0
  const middle = length - 2 * zone
  const steps = Math.max(0, Math.ceil(middle / s.spacing - 1e-9))
  const out: number[] = [0]
  for (let i = 1; i <= dense; i++) out.push((zone * i) / dense)
  for (let i = 1; i <= steps; i++) out.push(zone + (middle * i) / steps)
  for (let i = 1; i <= dense; i++) out.push(length - zone + (zone * i) / dense)
  return out
}

/** Estribo cerrado con dos ganchos de 135° alrededor de una sección b × h con recubrimiento c. */
function stirrup(b: number, h: number, c: number, no: BarNo): { legs: number[]; cut: number } {
  const a = b - 2 * c
  const d = h - 2 * c
  const hook = NSR10.hook135(BARS[no].db)
  return { legs: [a, d, a, d, hook], cut: 2 * (a + d) + 2 * hook }
}

/**
 * Barras longitudinales de `run` metros con ganchos de 90° en los extremos. Si no caben en una
 * varilla comercial de 6 m, se parten en tramos traslapados (50 db cada empalme).
 */
function longitudinal(run: number, no: BarNo, hooks: boolean): { shape: BarShape; legs: number[]; cut: number; pieces: number } {
  const db = BARS[no].db
  const hook = hooks ? NSR10.hook90(db) : 0
  const splice = NSR10.spliceDiameters * db
  const total = run + 2 * hook
  const pieces = total <= NSR10.barStock ? 1 : Math.ceil((total - splice) / (NSR10.barStock - splice) - 1e-9)
  const cut = (total + (pieces - 1) * splice) / pieces
  return hooks ? { shape: 'L', legs: [hook, run, hook], cut, pieces } : { shape: 'recta', legs: [run], cut, pieces }
}

function linearBars(e: LinearElement): Bar[] {
  if (!e.rebar) return []
  const cover = e.kind === 'footing' ? NSR10.cover.footing : NSR10.cover.beam
  const len = distance(e.start, e.end)
  const run = len - 2 * cover
  const long = longitudinal(run, e.rebar.bars.no, e.kind !== 'lintel')
  const st = stirrup(e.width, e.height, cover, e.rebar.stirrups.no)
  return [
    { mark: `${e.id}-L`, elementId: e.id, no: e.rebar.bars.no, shape: long.shape, legs: long.legs, cutLength: long.cut, count: e.rebar.bars.count * long.pieces },
    { mark: `${e.id}-E`, elementId: e.id, no: e.rebar.stirrups.no, shape: 'estribo', legs: st.legs, cutLength: st.cut, count: stirrupCount(run, e.rebar.stirrups) },
  ]
}

function columnBars(c: TieColumn): Bar[] {
  const cover = NSR10.cover.column
  // las barras atraviesan la viga de amarre de arriba y rematan con gancho dentro de ella
  const run = c.height + NSR10.beamHeight - cover
  const long = longitudinal(run, c.rebar.bars.no, true)
  const st = stirrup(c.across, c.along, cover, c.rebar.stirrups.no)
  return [
    { mark: `${c.id}-L`, elementId: c.id, no: c.rebar.bars.no, shape: long.shape, legs: long.legs, cutLength: long.cut, count: c.rebar.bars.count * long.pieces },
    { mark: `${c.id}-E`, elementId: c.id, no: c.rebar.stirrups.no, shape: 'estribo', legs: st.legs, cutLength: st.cut, count: stirrupCount(c.height, c.rebar.stirrups) },
  ]
}

/** Todas las barras de la estructura, en el orden de la obra (cimientos, columnetas, vigas, dinteles). */
export function rebarSchedule(s: Structure): Bar[] {
  return [...s.footings.flatMap(linearBars), ...s.columns.flatMap(columnBars), ...s.beams.flatMap(linearBars), ...s.lintels.flatMap(linearBars)]
}

/** Kilos de acero por diámetro. */
export function steelByDiameter(bars: Bar[]): Map<BarNo, number> {
  const out = new Map<BarNo, number>()
  for (const b of bars) out.set(b.no, (out.get(b.no) ?? 0) + barWeight(b))
  return out
}

const SHAPE_LABEL: Record<BarShape, string> = { recta: 'Recta', L: 'Con ganchos de 90°', estribo: 'Estribo cerrado 135°' }

/** Despiece para el ferretero: una fila por marca y el total de kilos por diámetro. */
export function rebarCsv(bars: Bar[]): string {
  const head = ['Marca', 'Elemento', 'Barra', 'Forma', 'Tramos (m)', 'Cantidad', 'Largo de corte (m)', 'Largo total (m)', 'Peso (kg)']
  const rows = bars.map((b) => [
    b.mark,
    b.elementId,
    BARS[b.no].name,
    SHAPE_LABEL[b.shape],
    b.legs.map((l) => csvNum(l)).join(' + '),
    String(b.count),
    csvNum(b.cutLength),
    csvNum(b.cutLength * b.count),
    csvNum(barWeight(b), 1),
  ])
  for (const [no, kg] of [...steelByDiameter(bars)].sort(([a], [b]) => a - b)) rows.push(['Total', '', BARS[no].name, '', '', '', '', '', csvNum(kg, 1)])
  return csv(head, rows)
}

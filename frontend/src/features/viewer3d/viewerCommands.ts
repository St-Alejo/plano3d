/**
 * Chat del visor 3D: frases como "modo acero", "oculta el ladrillo", "ve al paso 7",
 * "muestra la columneta C-3" o "¿cuántos ladrillos?" → `ViewerAction`.
 *
 * No toca el plano, solo la vista y los ajustes de obra. Primero entiende este intérprete
 * local (gratis, sin red); lo que no entiende va a Claude en el servidor, que responde
 * con las mismas acciones (`asViewerActions` filtra lo que llega).
 */
import type { BuildingModel } from '@/api/types'
import { roomArea } from '@/domain/model'
import { fold } from '@/domain/planOps'
import type { BrickId } from '@/domain/structure/bricks'
import { deriveStructure } from '@/domain/structure/derive'
import { masonryLayout } from '@/domain/structure/masonryLayout'
import { buyAmount, quantities, quantityTotals, type QuantityLine } from '@/domain/structure/quantities'
import type { Quality } from './Viewer3D'
import type { CameraPreset, DisplayMode } from './scene/viewTools'

export type PlanModeId = 'presentacion' | 'obra' | 'acero' | 'secuencia'
export type QuantityTopic = 'ladrillo' | 'cemento' | 'arena' | 'grava' | 'acero' | 'concreto' | 'area' | 'todo'
/** número de paso (desde 1) o un movimiento de la línea de tiempo */
export type StepTarget = number | 'next' | 'prev' | 'last' | 'play'

export type ViewerAction =
  | { a: 'plan_mode'; id: PlanModeId }
  | { a: 'camera'; mode: 'orbit' | 'walk' }
  | { a: 'preset'; name: CameraPreset }
  | { a: 'display'; mode: DisplayMode }
  | { a: 'quality'; q: Quality }
  | { a: 'roof'; on: boolean }
  | { a: 'brick'; id: BrickId }
  | { a: 'masonry'; hidden: boolean }
  | { a: 'element'; id: string }
  | { a: 'step'; to: StepTarget }
  | { a: 'cut'; on: boolean; at?: number }
  | { a: 'sun'; on: boolean; hour?: number }
  | { a: 'overlay'; value: number }
  | { a: 'room'; room: string }
  | { a: 'ask'; topic: QuantityTopic }

export interface ViewerParse {
  actions: ViewerAction[]
  /** fragmentos que no se entendieron (vacío = todo entendido) */
  unknown: string[]
}

const OFF = /\b(?:quita|quitale|oculta|ocultale|esconde|apaga|desactiva|sin|cierra|saca|retira|elimina)\b/
const NUM = /(\d+(?:[.,]\d+)?)\s*(cm|centimetros|m|mts|metros)?\b/
const num = (s: string) => Number(s.replace(',', '.'))

const VERBS = 'muestra|muestrame|ensena|ensename|oculta|esconde|quita|pon|ponle|activa|desactiva|apaga|enciende|cambia|usa|ve|vete|anda|llevame|mira|abre|cierra|sube|baja|haz|corta|reproduce|avanza|retrocede|cuanto|cuantos|cuantas|cuanta'
const CUT = new RegExp(`\\s*(?:[;\\n]|,(?!\\d)|\\.(?!\\d)|\\s+y\\s+(?=(?:luego\\s+|despues\\s+)?(?:${VERBS})\\b)|\\s+(?:luego|despues)\\s+)\\s*`)

/** Órdenes de un mensaje, en minúsculas y sin tildes. */
function clauses(message: string): { orig: string; f: string }[] {
  return message
    .split(CUT)
    .map((orig) => orig.replace(/^[\s¿¡]*(?:y\s+|luego\s+|despues\s+|por favor\s+)*/i, '').replace(/[\s?!.¿¡]+$/, ''))
    .filter((orig) => orig.trim().length > 0)
    .map((orig) => ({ orig: orig.trim(), f: fold(orig).replace(/\s+/g, ' ') }))
}

const TOPICS: [RegExp, QuantityTopic][] = [
  [/ladrillo|bloque/, 'ladrillo'],
  [/cemento/, 'cemento'],
  [/arena/, 'arena'],
  [/grava|triturado/, 'grava'],
  [/acero|hierro|varilla/, 'acero'],
  [/concreto/, 'concreto'],
  [/\barea\b|metros cuadrados|\bm2\b|mide la casa/, 'area'],
  [/material|comprar|compro|todo|necesito/, 'todo'],
]

/** Elemento de obra: "C-3", "columneta 3", "viga de amarre 2", "dintel D-1". */
function elementId(f: string): string | null {
  const id = /\b(?:(vc|va|sc|c)-?(\d+)|(m|d)-(\d+))\b/.exec(f)
  if (id) return `${(id[1] ?? id[3])!.toUpperCase()}-${id[2] ?? id[4]}`
  const named: [RegExp, string][] = [
    [/\bcolumn(?:eta|a)\s+(?:c-?)?(\d+)\b/, 'C'],
    [/\bviga de amarre\s+(?:va-?)?(\d+)\b/, 'VA'],
    [/\bviga de cimentacion\s+(?:vc-?)?(\d+)\b/, 'VC'],
    [/\bsobrecimiento\s+(?:sc-?)?(\d+)\b/, 'SC'],
    [/\bdintel\s+(?:d-?)?(\d+)\b/, 'D'],
    [/\b(?:pano|muro)\s+(?:m-?)?(\d+)\b/, 'M'],
  ]
  for (const [re, prefix] of named) {
    const m = re.exec(f)
    if (m) return `${prefix}-${m[1]}`
  }
  return null
}

/** Hora del estudio solar: "a las 4 de la tarde", "a las 15:30". */
function hourOf(f: string): number | undefined {
  const m = /\b(?:a las|las|a la)\s+(\d{1,2})(?::(\d{2}))?\s*(?:de la\s+)?(manana|tarde|noche|am|pm)?/.exec(f)
  if (!m) return undefined
  let h = Number(m[1]) + Number(m[2] ?? 0) / 60
  if ((m[3] === 'tarde' || m[3] === 'noche' || m[3] === 'pm') && h < 12) h += 12
  return Math.min(19, Math.max(5, h))
}

type Rule = (f: string, orig: string) => ViewerAction | ViewerAction[] | null

const RULES: Rule[] = [
  // preguntas de cantidades: "¿cuántos ladrillos?", "cuánto cemento necesito"
  (f) => {
    if (!/\b(?:cuant[oa]s?|que cantidad|que (?:material|hay que comprar)|area)\b/.test(f)) return null
    const hit = TOPICS.find(([re]) => re.test(f))
    return hit ? { a: 'ask', topic: hit[1] } : null
  },
  // secuencia: "paso 7", "siguiente paso", "reproduce la obra"
  (f) => {
    const n = /\bpaso\s+(?:numero\s+|n[o°]?\s*)?(\d+)\b/.exec(f)
    if (n) return { a: 'step', to: Number(n[1]) }
    if (/\b(?:siguiente|proximo)\s+paso\b|\bpaso\s+siguiente\b|\bavanza\b/.test(f)) return { a: 'step', to: 'next' }
    if (/\bpaso\s+anterior\b|\banterior\s+paso\b|\bretrocede\b|\bdevuelvete\b/.test(f)) return { a: 'step', to: 'prev' }
    if (/\b(?:primer paso|desde cero|desde el principio)\b/.test(f)) return { a: 'step', to: 1 }
    if (/\b(?:ultimo paso|obra terminada|casa terminada)\b/.test(f)) return { a: 'step', to: 'last' }
    if (/\b(?:reproduce|anima|play)\b/.test(f)) return { a: 'step', to: 'play' }
    return null
  },
  (f) => {
    const id = elementId(f)
    return id ? { a: 'element', id } : null
  },
  // unidad de mampostería: "usa bloque número 5", "con ladrillo tolete"
  (f) => {
    if (OFF.test(f)) return null
    if (/\bbloque/.test(f)) return { a: 'brick', id: 'bloque5' }
    if (/\btolete\b/.test(f)) return { a: 'brick', id: 'tolete' }
    return null
  },
  // "oculta el ladrillo" deja ver el esqueleto de concreto
  (f) => {
    if (/\besqueleto\b/.test(f)) return [{ a: 'plan_mode', id: 'obra' }, { a: 'masonry', hidden: true }]
    if (!/\b(?:ladrillos?|mamposteria|muros|paredes)\b/.test(f)) return null
    if (OFF.test(f)) return { a: 'masonry', hidden: true }
    if (/\b(?:muestra|muestrame|pon|ensena|vuelve|activa|ver)\b/.test(f)) return { a: 'masonry', hidden: false }
    return null
  },
  (f) => (/\b(?:techo|cubierta|teja|tejado)\b/.test(f) ? { a: 'roof', on: !OFF.test(f) } : null),
  (f) => {
    if (!/\b(?:corte|corta|cortala|seccion)\b/.test(f)) return null
    if (OFF.test(f)) return { a: 'cut', on: false }
    const m = NUM.exec(f)
    if (!m) return { a: 'cut', on: true }
    const v = num(m[1]!)
    return { a: 'cut', on: true, at: m[2]?.startsWith('c') || (!m[2] && v > 3) ? v / 100 : v }
  },
  (f) => (/\b(?:sol|solar|asoleamiento)\b/.test(f) ? { a: 'sun', on: !OFF.test(f), hour: hourOf(f) } : null),
  (f) => {
    const q = /\bcalidad\s+(alta|baja)\b/.exec(f)
    if (q) return { a: 'quality', q: q[1] as Quality }
    if (/\b(?:fluid[ao]|lento|se traba|mas rapido)\b/.test(f)) return { a: 'quality', q: 'baja' }
    if (/\b(?:mas realista|alta calidad|maxima calidad|mejor calidad)\b/.test(f)) return { a: 'quality', q: 'alta' }
    return null
  },
  (f) => {
    if (/\balambr/.test(f)) return { a: 'display', mode: 'wire' }
    if (/\brayos? x\b|\btransparente\b/.test(f)) return { a: 'display', mode: 'xray' }
    if (/\bmateriales\b/.test(f)) return { a: 'display', mode: 'material' }
    return null
  },
  (f) => {
    if (/\b(?:planta|desde arriba|vista superior|cenital|vista aerea)\b/.test(f)) return { a: 'preset', name: 'top' }
    if (/\bisometric/.test(f)) return { a: 'preset', name: 'iso' }
    if (/\bmaqueta\b|casa de munecas/.test(f)) return { a: 'preset', name: 'dollhouse' }
    if (/\b(?:frontal|de frente|fachada)\b/.test(f)) return { a: 'preset', name: 'front' }
    return null
  },
  (f) => {
    if (/\b(?:camina|caminar|recorre|recorrer|recorrido|primera persona)\b/.test(f)) return { a: 'camera', mode: 'walk' }
    if (/\b(?:orbita|orbitar|vista exterior)\b/.test(f)) return { a: 'camera', mode: 'orbit' }
    return null
  },
  (f) => {
    if (!/\bplano original\b/.test(f)) return null
    if (OFF.test(f)) return { a: 'overlay', value: 0 }
    const pct = /(\d+)\s*(?:%|por ciento)/.exec(f)
    return { a: 'overlay', value: pct ? Math.min(100, Number(pct[1])) / 100 : 0.5 }
  },
  // modos del plano; "quita el modo obra" vuelve a la presentación
  (f) => {
    const mode: PlanModeId | null = /\b(?:acero|despiece|hierro|varillas?|refuerzo)\b/.test(f)
      ? 'acero'
      : /\b(?:secuencia|paso a paso|cronograma|como se construye)\b/.test(f)
        ? 'secuencia'
        : /\b(?:obra|maestro|estructura|estructural)\b/.test(f)
          ? 'obra'
          : /\b(?:presentacion|normal|acabados|terminada)\b/.test(f)
            ? 'presentacion'
            : null
    if (!mode) return null
    return { a: 'plan_mode', id: OFF.test(f) ? 'presentacion' : mode }
  },
  // "ve a la cocina", "llévame al baño"
  (f, orig) => {
    const m = /^(?:ve|vete|ir|anda|llevame|vamos|muestrame|mira|ensename|entra)\s+(?:(?:a|al|hasta|hacia)\s+)?(?:(?:la|el)\s+)?(.+)$/.exec(f)
    if (!m) return null
    // el nombre se recorta del original para conservar tildes ("Baño")
    return { a: 'room', room: orig.slice(orig.length - m[1]!.length).trim() }
  },
]

export function parseViewerChat(message: string): ViewerParse {
  const actions: ViewerAction[] = []
  const unknown: string[] = []
  for (const c of clauses(message)) {
    const hit = RULES.map((r) => r(c.f, c.orig)).find((x) => x !== null)
    if (hit) actions.push(...(Array.isArray(hit) ? hit : [hit]))
    else unknown.push(c.orig)
  }
  return { actions, unknown }
}

/** Frases de ejemplo (chips del chat y ayuda cuando no se entiende). */
export const VIEWER_EXAMPLES = [
  'modo obra',
  'oculta el ladrillo',
  'muestra la columneta C-1',
  've al paso 3',
  '¿cuántos ladrillos?',
  'pon el techo',
  'corte a 1,2 m',
  'usa bloque Nº5',
]

// ----------------------------------------------------------------------------- respuestas de cantidades

const n0 = (v: number, unit: QuantityLine['unit']) =>
  (unit === 'und' || unit === 'bultos' ? buyAmount({ step: '', item: '', unit, amount: v }) : v).toLocaleString('es-CO', { maximumFractionDigits: unit === 'kg' ? 0 : 2 })

const WANT: Record<Exclude<QuantityTopic, 'area' | 'todo'>, (l: QuantityLine) => boolean> = {
  ladrillo: (l) => l.unit === 'und',
  cemento: (l) => l.item.startsWith('Cemento'),
  arena: (l) => l.item === 'Arena',
  grava: (l) => l.item === 'Grava',
  acero: (l) => l.item.startsWith('Acero') || l.item.startsWith('Alambre'),
  concreto: (l) => l.item.startsWith('Concreto'),
}

/** Respuesta a "¿cuántos…?" con las cantidades de obra del modelo (con desperdicio, para comprar). */
export function quantityAnswer(model: BuildingModel, brick: BrickId, topic: QuantityTopic): { text: string; lines: string[] } {
  if (topic === 'area') {
    const rooms = model.levels.flatMap((l) => l.rooms)
    const total = rooms.reduce((a, r) => a + roomArea(r), 0)
    return {
      text: `Los ambientes suman ${n0(total, 'm²')} m² en ${model.levels.length} ${model.levels.length === 1 ? 'piso' : 'pisos'}.`,
      lines: rooms.map((r) => `${r.label}: ${n0(roomArea(r), 'm²')} m²`),
    }
  }
  const s = deriveStructure(model, { brick })
  const totals = quantityTotals(quantities(model, s, masonryLayout(model, s)))
  const picked = topic === 'todo' ? totals : totals.filter(WANT[topic])
  if (picked.length === 0) return { text: 'Este plano no lleva eso (¿tiene muros confinados?).', lines: [] }
  const lines = picked.map((l) => `${l.item}: ${n0(l.amount, l.unit)} ${l.unit}`)
  if (topic === 'acero') {
    const kg = picked.filter((l) => l.unit === 'kg').reduce((a, l) => a + l.amount, 0)
    return { text: `Unos ${n0(kg, 'kg')} kg de acero en total, ya con desperdicio:`, lines }
  }
  if (topic === 'concreto') {
    const m3 = picked.reduce((a, l) => a + l.amount, 0)
    return { text: `Unos ${n0(m3, 'm³')} m³ de concreto en total, ya con desperdicio:`, lines }
  }
  if (picked.length === 1) return { text: `${lines[0]} (ya con desperdicio).`, lines: [] }
  return { text: 'Cantidades para comprar (ya con desperdicio):', lines }
}

// ----------------------------------------------------------------------------- respaldo con IA

const MODES = new Set<PlanModeId>(['presentacion', 'obra', 'acero', 'secuencia'])
const ok: Record<ViewerAction['a'], (o: Record<string, unknown>) => boolean> = {
  plan_mode: (o) => MODES.has(o.id as PlanModeId),
  camera: (o) => o.mode === 'orbit' || o.mode === 'walk',
  preset: (o) => ['iso', 'dollhouse', 'top', 'front'].includes(o.name as string),
  display: (o) => ['material', 'wire', 'xray'].includes(o.mode as string),
  quality: (o) => o.q === 'alta' || o.q === 'baja',
  roof: (o) => typeof o.on === 'boolean',
  brick: (o) => o.id === 'tolete' || o.id === 'bloque5',
  masonry: (o) => typeof o.hidden === 'boolean',
  element: (o) => typeof o.id === 'string',
  step: (o) => (typeof o.to === 'number' && o.to >= 1) || ['next', 'prev', 'last', 'play'].includes(o.to as string),
  cut: (o) => typeof o.on === 'boolean' && (o.at === undefined || typeof o.at === 'number'),
  sun: (o) => typeof o.on === 'boolean' && (o.hour === undefined || typeof o.hour === 'number'),
  overlay: (o) => typeof o.value === 'number' && o.value >= 0 && o.value <= 1,
  room: (o) => typeof o.room === 'string',
  ask: (o) => ['ladrillo', 'cemento', 'arena', 'grava', 'acero', 'concreto', 'area', 'todo'].includes(o.topic as string),
}

/** Filtra lo que llega del servidor: solo acciones conocidas y bien formadas. */
export function asViewerActions(raw: unknown): ViewerAction[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((o): o is ViewerAction => {
    if (typeof o !== 'object' || o === null) return false
    const check = ok[(o as { a?: string }).a as ViewerAction['a']]
    return check ? check(o as Record<string, unknown>) : false
  })
}

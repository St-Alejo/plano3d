/**
 * Intérprete local del chat: frases frecuentes en español → `PlanOp`.
 *
 * Funciona sin red ni costo. Si alguna parte del mensaje no se entiende, el chat
 * puede pedirle el mensaje completo a Claude (respaldo). Las expresiones se aplican
 * sobre una copia del texto sin tildes y en minúsculas que conserva la longitud, así
 * los nombres se recortan del texto original y conservan sus tildes ("Baño").
 */
import type { OpeningKind, WallKind } from '@/api/types'
import { FLOOR_MATERIALS, WALL_MATERIALS, type MaterialSpec } from './materials'
import { findMaterial, type PlanOp, type Side } from './planOps'

export interface ParseResult {
  ops: PlanOp[]
  /** fragmentos que no se entendieron (vacío = todo entendido) */
  unknown: string[]
}

/** sin tildes y en minúsculas, carácter por carácter (misma longitud que el original) */
function foldSameLength(s: string): string {
  return [...s].map((ch) => (ch.normalize('NFD')[0] ?? ch).toLowerCase()).join('')
}

const SIDE_WORDS: Record<string, Side> = {
  norte: 'norte',
  arriba: 'norte',
  sur: 'sur',
  abajo: 'sur',
  este: 'este',
  derecha: 'este',
  oriente: 'este',
  oeste: 'oeste',
  izquierda: 'oeste',
  occidente: 'oeste',
}
const SIDE = `(?:${Object.keys(SIDE_WORDS).join('|')})`
const NUM = `\\d+(?:[.,]\\d+)?`
const UNIT = `(?:\\s*(?:m|mts|metros)\\b)?`
const DE = `(?:de la|del|de los|de las|de|en la|en el|en)`
const ART = `(?:(?:la|el|los|las|una|un|otra|otro)\\s+)?`
const VERB_ADD = `(?:(?:agrega|agregale|anade|anadele|pon|ponle|crea|dibuja|haz|abre|mete|coloca)\\s+)?`

const num = (s: string) => Number(s.replace(',', '.'))
const side = (s: string | undefined): Side | undefined => (s ? SIDE_WORDS[s] : undefined)
const kindOf = (s: string): OpeningKind => (s === 'puerta' ? 'door' : 'window')

type Grp = Record<string, string | undefined>
interface Rule {
  re: RegExp
  build: (g: Grp, ctx: Ctx) => PlanOp | null
}
interface Ctx {
  lastRoom?: string
}

const rx = (src: string) => new RegExp(`^${src}$`, 'd')

const WALL = `(?:muros?|paredes?)`
const WALL_SIDE = `(?:\\s+(?:del?\\s+)?(?:lado\\s+)?(?<side>${SIDE}))?`
const ROOM_OPT = `(?:\\s+${DE}\\s+${ART}(?<room>[a-z].*?))?`
const MEASURE = `(?<v>${NUM})\\s*(?<u>cm|centimetros|m|mts|metros)?`

/**
 * Metros a partir de "20 cm", "0,2 m" o un número suelto: sin unidad, lo que pasa de
 * `cmAbove` se lee en centímetros ("muros de 20" → 0,20 m; "puerta de 80" → 0,80 m).
 */
function meters(v: string, unit: string | undefined, cmAbove: number): number {
  const n = num(v)
  if (unit?.startsWith('c')) return n / 100
  return unit || n <= cmAbove ? n : n / 100
}

/** "muros de 20 cm" es espesor y "sube los muros a 2,8" es altura; si no se dice, lo decide la medida. */
function wallMeasure(g: Grp): { thickness: number } | { height: number } {
  if (g.dim === 'espesor' || g.dim === 'grosor' || g.dim === 'ancho') return { thickness: meters(g.v!, g.u, 1) }
  if (g.dim === 'alto' || g.dim === 'altura' || /^(?:sube|baja)/.test(g.verb ?? '')) return { height: meters(g.v!, g.u, 12) }
  // sin unidad, hasta 12 son metros y más de 12 centímetros; 60 cm o menos es espesor
  const value = meters(g.v!, g.u, 12)
  return value <= 0.6 ? { thickness: value } : { height: value }
}

/** El ambiente de un muro: el nombrado, el de la orden anterior si se dijo un lado, o ninguno (todo el nivel). */
const wallRoom = (g: Grp, ctx: Ctx) => g.room?.trim() || (g.side ? roomOr(undefined, ctx) : undefined)

function material(list: MaterialSpec[], text: string | undefined): string | null {
  if (!text) return null
  try {
    findMaterial(list, text)
    return text.trim()
  } catch {
    return null
  }
}

const KIND_WORD: [RegExp, Partial<{ wall_kind: WallKind; structural: boolean }>][] = [
  [/^no (?:estructural|portante)/, { structural: false }],
  [/^(?:estructural|portante)/, { structural: true }],
  [/^(?:tabique|divisori)/, { wall_kind: 'partition' }],
  [/^exterior/, { wall_kind: 'exterior' }],
  [/^interior/, { wall_kind: 'interior' }],
]

function roomOr(g: string | undefined, ctx: Ctx): string {
  const r = g?.trim() || ctx.lastRoom
  if (!r) throw new NeedsRoom()
  return r
}
class NeedsRoom extends Error {}

const RULES: Rule[] = [
  // muros: "muros de 20 cm", "sube los muros a 2,8 m", "el muro norte de la sala de 25 cm de espesor"
  {
    re: rx(
      `(?:(?<verb>haz|hazle|deja|dejale|cambia|cambiale|pon|ponle|ponles|sube|subele|baja|bajale|ajusta|engruesa|adelgaza)\\s+)?${ART}${WALL}${WALL_SIDE}${ROOM_OPT}\\s+(?:a|de|en|con)\\s+${MEASURE}(?:\\s+de\\s+(?<dim>espesor|grosor|ancho|alto|altura))?`,
    ),
    build: (g, ctx) => ({ op: 'set_wall', room: wallRoom(g, ctx), side: side(g.side), ...wallMeasure(g) }),
  },
  // "la altura de los muros a 2,8", "espesor de los muros de la cocina 20 cm"
  {
    re: rx(
      `(?:(?:cambia|cambiale|pon|ponle|sube|baja|deja|ajusta)\\s+)?${ART}(?<dim>espesor|grosor|altura|alto)\\s+de\\s+${ART}${WALL}${WALL_SIDE}${ROOM_OPT}\\s+(?:(?:a|de|en|es|sea)\\s+)?${MEASURE}`,
    ),
    build: (g, ctx) => ({ op: 'set_wall', room: wallRoom(g, ctx), side: side(g.side), ...wallMeasure(g) }),
  },
  // tipo de muro: "el muro este de la sala es tabique", "haz estructurales los muros de la cocina"
  {
    re: rx(
      `(?:(?:haz|hazle|deja|vuelve|marca|convierte|cambia|pon)\\s+)?${ART}${WALL}${WALL_SIDE}${ROOM_OPT}\\s+(?:(?:como|a|en|es|son|sea|sean)\\s+)?(?:(?:un|una|muro|muros)\\s+)?(?<what>tabiques?|divisori[oa]s?|(?:no\\s+)?estructural(?:es)?|(?:no\\s+)?portantes?|exteriore?s?|interiore?s?)`,
    ),
    build: (g, ctx) => {
      const hit = KIND_WORD.find(([re]) => re.test(g.what!))
      return hit ? { op: 'set_wall', room: wallRoom(g, ctx), side: side(g.side), ...hit[1] } : null
    },
  },
  // acabado de muros: "pinta los muros de la sala de verde", "enchapa el muro sur del baño en ladrillo"
  {
    re: rx(
      `(?:pinta|pintale|pintales|enchapa|acaba|cambia el acabado de|cambia el color de)\\s+${ART}${WALL}${WALL_SIDE}${ROOM_OPT}\\s+(?:de|en|con|a|color)\\s+(?:color\\s+)?(?<mat>.+)`,
    ),
    build: (g, ctx) => {
      const mat = material(WALL_MATERIALS, g.mat)
      return mat ? { op: 'set_wall', room: wallRoom(g, ctx), side: side(g.side), material: mat } : null
    },
  },
  // "pinta la sala de blanco": todos sus muros
  {
    re: rx(`(?:pinta|pintale)\\s+${ART}(?<room>[a-z].*?)\\s+(?:de|en|con|color)\\s+(?:color\\s+)?(?<mat>.+)`),
    build: (g) => {
      const mat = material(WALL_MATERIALS, g.mat)
      return mat ? { op: 'set_wall', room: g.room!, material: mat } : null
    },
  },
  // piso: "piso de madera en la sala", "pon porcelanato de piso en el baño"
  {
    re: rx(`(?:(?:pon|ponle|mete|usa)\\s+)?(?:un\\s+|el\\s+)?piso\\s+(?:de\\s+|en\\s+)?(?<mat>.+?)\\s+(?:en|a|para)\\s+${ART}(?<room>.+)`),
    build: (g) => {
      const mat = material(FLOOR_MATERIALS, g.mat)
      return mat ? { op: 'set_floor', room: g.room!, material: mat } : null
    },
  },
  // "cambia el piso de la cocina a porcelanato", "piso del baño en baldosa"
  {
    re: rx(`(?:(?:cambia|cambiale|pon|ponle|haz)\\s+)?(?:el\\s+)?piso\\s+${DE}\\s+${ART}(?<room>.+?)\\s+(?:a|en|de|por|con)\\s+(?<mat>.+)`),
    build: (g) => {
      const mat = material(FLOOR_MATERIALS, g.mat)
      return mat ? { op: 'set_floor', room: g.room!, material: mat } : null
    },
  },
  // tamaño de un ambiente que ya existe: "agranda la sala a 5x4", "deja la cocina de 3 por 3,5"
  {
    re: rx(
      `(?:agranda|amplia|achica|reduce|redimensiona|ajusta|deja|cambia(?:\\s+el\\s+tamano\\s+de)?)\\s+(?:(?:la|el)\\s+)?(?<room>[a-z].*?)\\s+(?:a|de|en)\\s+(?<w>${NUM})${UNIT}\\s*(?:x|por|×)\\s*(?<h>${NUM})${UNIT}`,
    ),
    build: (g) => ({ op: 'resize_room', room: g.room!, width: num(g.w!), depth: num(g.h!) }),
  },
  // "agranda la sala a 5 m de ancho", "la cocina de 4 de fondo"
  {
    re: rx(
      `(?:(?:agranda|amplia|achica|reduce|alarga|acorta|ajusta|deja|cambia)\\s+)?(?:(?:la|el)\\s+)?(?<room>[a-z].*?)\\s+(?:a|de|en)\\s+(?<v>${NUM})${UNIT}\\s+de\\s+(?<dim>ancho|fondo|largo|profundidad)`,
    ),
    build: (g) => ({ op: 'resize_room', room: g.room!, ...(g.dim === 'ancho' ? { width: num(g.v!) } : { depth: num(g.v!) }) }),
  },
  // medida de una abertura: "la puerta del baño de 0,8", "ensancha la ventana norte de la sala a 1,5 m"
  {
    re: rx(
      `(?:(?:haz|hazle|deja|cambia|pon|ponle|ensancha|agranda|achica|angosta|ajusta|sube|baja)\\s+)?${ART}(?<kind>puerta|ventana)(?:\\s+(?:del?\\s+)?(?:muro\\s+|lado\\s+)?(?<side>${SIDE}))?\\s+${DE}\\s+${ART}(?<room>[a-z].*?)(?:\\s+(?:al|del)\\s+(?:muro\\s+|lado\\s+)?(?<side2>${SIDE}))?\\s+(?:a|de|en)\\s+${MEASURE}(?:\\s+de\\s+(?<dim>ancho|alto|altura))?`,
    ),
    build: (g) => {
      const v = meters(g.v!, g.u, 4)
      const what = g.dim === 'alto' || g.dim === 'altura' ? { height: v } : { width: v }
      return { op: 'set_opening', kind: kindOf(g.kind!), room: g.room!, side: side(g.side ?? g.side2), ...what }
    },
  },
  // "sube el antepecho de la ventana de la cocina a 1,2"
  {
    re: rx(
      `(?:(?:sube|baja|pon|ponle|cambia|deja)\\s+)?(?:el\\s+)?(?:antepecho|alfeizar)\\s+de\\s+${ART}(?<kind>ventana|puerta)(?:\\s+(?<side>${SIDE}))?\\s+${DE}\\s+${ART}(?<room>[a-z].*?)\\s+(?:a|en|de)\\s+${MEASURE}`,
    ),
    build: (g) => ({ op: 'set_opening', kind: kindOf(g.kind!), room: g.room!, side: side(g.side), sill: meters(g.v!, g.u, 3) }),
  },
  // renombrar: "renombra la alcoba 1 a estudio", "cambia el nombre de la sala por estar"
  {
    re: rx(`(?:renombra|cambia(?:le)? el nombre (?:de|a)|ponle de nombre a|llama)\\s+${ART}(?<room>.+?)\\s+(?:a|como|por)\\s+(?<name>.+)`),
    build: (g) => ({ op: 'rename_room', room: g.room!, name: g.name! }),
  },
  // mover: "mueve la puerta del baño al este", "pasa la ventana norte de la sala al sur de la cocina"
  {
    re: rx(
      `(?:mueve|muevele|pasa|cambia|lleva|corre)\\s+${ART}(?<kind>puerta|ventana)(?:\\s+(?:del?\\s+)?(?:muro\\s+|lado\\s+)?(?<from>${SIDE}))?(?:\\s+${DE}\\s+${ART}(?<room>.+?))?\\s+(?:al|a la|hacia el|hacia la|hacia|a)\\s+(?:muro\\s+|lado\\s+|pared\\s+)?(?<to>${SIDE})(?:\\s+${DE}\\s+${ART}(?<toRoom>.+))?`,
    ),
    build: (g, ctx) => ({
      op: 'move_opening',
      kind: kindOf(g.kind!),
      room: roomOr(g.room, ctx),
      from_side: side(g.from),
      to_side: side(g.to)!,
      to_room: g.toRoom?.trim() || undefined,
    }),
  },
  // borrar abertura: "borra la ventana de la cocina", "quita la puerta norte de la sala"
  {
    re: rx(
      `(?:borra|elimina|quita|saca|borrale|quitale)\\s+${ART}(?<kind>puerta|ventana)(?:\\s+(?:del?\\s+)?(?:muro\\s+|lado\\s+)?(?<side>${SIDE}))?(?:\\s+${DE}\\s+${ART}(?<room>.+?))?(?:\\s+(?:al|del|en el)\\s+(?:muro\\s+|lado\\s+)?(?<side2>${SIDE}))?`,
    ),
    build: (g, ctx) => ({ op: 'delete_opening', kind: kindOf(g.kind!), room: roomOr(g.room, ctx), side: side(g.side ?? g.side2) }),
  },
  // abertura entre dos ambientes: "puerta entre la sala y la cocina"
  {
    re: rx(`${VERB_ADD}${ART}(?<kind>puerta|ventana)(?:\\s+de\\s+(?<w>${NUM})${UNIT})?\\s+entre\\s+${ART}(?<a>.+?)\\s+&\\s+${ART}(?<b>.+)`),
    build: (g) => ({ op: 'add_opening', kind: kindOf(g.kind!), room: g.a!, between: g.b!, width: g.w ? num(g.w) : undefined }),
  },
  // agregar abertura: "puerta al sur", "ventana de 1,20 en el norte de la alcoba", "pon una puerta en la cocina al este"
  {
    re: rx(
      `${VERB_ADD}${ART}(?<kind>puerta|ventana)(?:\\s+de\\s+(?<w>${NUM})${UNIT})?(?:\\s+(?:en|al|a la|hacia el|hacia la|hacia|por el|por la)\\s*(?:el\\s+|la\\s+)?(?:muro\\s+|pared\\s+|lado\\s+)?(?<side>${SIDE}))?(?:\\s+${DE}\\s+${ART}(?<room>.+?))?(?:\\s+(?:al|hacia el|hacia la|hacia|en el|por el)\\s+(?:muro\\s+|lado\\s+)?(?<side2>${SIDE}))?`,
    ),
    build: (g, ctx) => ({ op: 'add_opening', kind: kindOf(g.kind!), room: roomOr(g.room, ctx), side: side(g.side ?? g.side2), width: g.w ? num(g.w) : undefined }),
  },
  // ambiente: "sala de 4x5", "cocina de 3 por 3 al este de la sala", "baño 2x1,5 al lado de la alcoba"
  {
    re: rx(
      `${VERB_ADD}${ART}(?<name>[a-z][a-z0-9 ]*?)\\s+(?:de\\s+)?(?<w>${NUM})${UNIT}\\s*(?:x|por|×)\\s*(?<h>${NUM})${UNIT}(?:\\s+(?:al|a la|hacia el|hacia la)\\s+(?<side>${SIDE})\\s+${DE}\\s+${ART}(?<ref>.+?)|\\s+al lado\\s+${DE}\\s+${ART}(?<beside>.+?)|\\s+(?:debajo|abajo)\\s+${DE}\\s+${ART}(?<below>.+?)|\\s+(?:encima|arriba)\\s+${DE}\\s+${ART}(?<above>.+?))?`,
    ),
    build: (g) => {
      const ref = g.ref ?? g.beside ?? g.below ?? g.above
      const s: Side = g.ref ? side(g.side)! : g.below ? 'sur' : g.above ? 'norte' : 'este'
      return { op: 'add_room', name: g.name!.trim(), width: num(g.w!), depth: num(g.h!), next_to: ref ? { room: ref.trim(), side: s } : undefined }
    },
  },
  // borrar ambiente: "borra la cocina", "elimina el ambiente estudio"
  {
    re: rx(`(?:borra|elimina|quita)\\s+(?:el ambiente\\s+|la habitacion\\s+|el cuarto\\s+)?${ART}(?<room>.+)`),
    build: (g) => ({ op: 'delete_room', room: g.room! }),
  },
  // mueble: "pon una cama doble en la alcoba 1"
  {
    re: rx(`(?:agrega|anade|pon|coloca|mete)\\s+${ART}(?<item>.+?)\\s+(?:en|a)\\s+${ART}(?<room>.+)`),
    build: (g) => ({ op: 'add_furniture', item: g.item!, room: g.room! }),
  },
]

const SPLIT_VERBS = 'agrega|agregale|anade|crea|pon|ponle|dibuja|haz|borra|elimina|quita|saca|mueve|pasa|cambia|renombra|llama|coloca|luego|despues|una?|otra?|la|el|puerta|ventana'

/** Parte el mensaje en órdenes: comas, puntos, "y luego", "y la/una…" y "con puerta…". */
function clauses(orig: string): { orig: string; f: string }[] {
  // "entre la sala y la cocina": se protege la "y" para no partir ahí
  let o = orig.replace(/(entre\s+.+?)\s+y\s+/gi, '$1 & ')
  o = o.replace(/\s+/g, ' ').trim()
  const f = foldSameLength(o)
  const cut = new RegExp(`\\s*(?:[;\\n]|,(?!\\d)|\\.(?!\\d)|\\s+y\\s+(?=(?:${SPLIT_VERBS})\\b)|\\s+(?=con\\s+(?:una?\\s+)?(?:puerta|ventana)))\\s*`, 'g')
  const out: { orig: string; f: string }[] = []
  let last = 0
  for (const m of f.matchAll(cut)) {
    out.push({ orig: o.slice(last, m.index), f: f.slice(last, m.index) })
    last = m.index + m[0].length
  }
  out.push({ orig: o.slice(last), f: f.slice(last) })
  return out
    .map(({ orig: co, f: cf }) => {
      // "con puerta al sur" → "puerta al sur"; "y luego…" → "…"
      const lead = /^(?:con|y|luego|despues|y luego|y despues)\s+/.exec(cf)?.[0].length ?? 0
      const tail = /[\s!?¡¿]+$/.exec(cf.slice(lead))?.[0].length ?? 0
      return { orig: co.slice(lead, co.length - tail), f: cf.slice(lead, cf.length - tail) }
    })
    .filter((c) => c.f.length > 0)
}

/** Grupos con nombre, recortados del texto ORIGINAL (conserva tildes y mayúsculas). */
function groupsOf(m: RegExpExecArray, orig: string): Grp {
  const out: Grp = {}
  const idx = m.indices?.groups ?? {}
  for (const [k, v] of Object.entries(idx)) {
    if (!v) continue
    // nombres: del original; palabras clave (tipo, lado, números): del texto plegado
    out[k] = ['room', 'name', 'a', 'b', 'ref', 'beside', 'below', 'above', 'toRoom', 'item'].includes(k) ? orig.slice(v[0], v[1]) : m.groups![k]
  }
  return out
}

export function parseChat(message: string): ParseResult {
  const ops: PlanOp[] = []
  const unknown: string[] = []
  const ctx: Ctx = {}
  for (const c of clauses(message)) {
    let done = false
    for (const rule of RULES) {
      const m = rule.re.exec(c.f)
      if (!m) continue
      try {
        const op = rule.build(groupsOf(m, c.orig), ctx)
        if (!op) continue
        ops.push(op)
        if (op.op === 'add_room') ctx.lastRoom = op.name
        else if ('room' in op && op.room) ctx.lastRoom = op.op === 'rename_room' ? op.name : op.room
        done = true
        break
      } catch (e) {
        if (e instanceof NeedsRoom) continue
        throw e
      }
    }
    if (!done) unknown.push(c.orig)
  }
  return { ops, unknown }
}

/** Frases de ejemplo (chips del chat y ayuda cuando no se entiende). */
export const EXAMPLES = [
  'sala de 4x5',
  'cocina de 3x3 al este de la sala con puerta al sur',
  'puerta entre la sala y la cocina',
  'ventana de 1,5 al norte de la sala',
  'mueve la puerta de la cocina al este',
  'borra la ventana de la sala',
  'renombra la cocina a comedor',
  'pon una cama doble en la alcoba',
  'muros de 20 cm',
  'agranda la sala a 5x4',
  'la puerta de la cocina de 1 m',
  'piso de madera en la sala',
  'pinta los muros de la sala de verde',
  'el muro este de la sala es tabique',
]

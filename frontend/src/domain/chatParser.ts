/**
 * Intérprete local del chat: frases frecuentes en español → `PlanOp`.
 *
 * Funciona sin red ni costo. Si alguna parte del mensaje no se entiende, el chat
 * puede pedirle el mensaje completo a Claude (respaldo). Las expresiones se aplican
 * sobre una copia del texto sin tildes y en minúsculas que conserva la longitud, así
 * los nombres se recortan del texto original y conservan sus tildes ("Baño").
 */
import type { OpeningKind } from '@/api/types'
import type { PlanOp, Side } from './planOps'

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

function roomOr(g: string | undefined, ctx: Ctx): string {
  const r = g?.trim() || ctx.lastRoom
  if (!r) throw new NeedsRoom()
  return r
}
class NeedsRoom extends Error {}

const RULES: Rule[] = [
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
        else if ('room' in op) ctx.lastRoom = op.op === 'rename_room' ? op.name : op.room
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
]

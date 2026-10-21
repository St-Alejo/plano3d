/**
 * Ficha de un elemento para el maestro: qué es, sus medidas y cómo va el hierro, en el
 * lenguaje de la obra ("4 Nº3, estribos Nº2 c/0,10 en 0,45 m junto a los nudos").
 */
import { distance } from '../model'
import { BRICKS } from './bricks'
import type { LinearElement, Structure, TieColumn } from './derive'
import type { Brick } from './masonryLayout'
import { BARS, type Reinforcement } from './nsr10'

export interface ElementCard {
  title: string
  lines: string[]
}

const m = (v: number, digits = 2) => v.toFixed(digits).replace('.', ',')

export function rebarText(r: Reinforcement): string {
  const bars = `${r.bars.count} ${BARS[r.bars.no].name}`
  const s = r.stirrups
  const st = s.nodeSpacing && s.nodeZone
    ? `estribos ${BARS[s.no].name} c/${m(s.nodeSpacing)} en ${m(s.nodeZone)} m junto a cada nudo y c/${m(s.spacing)} en el centro`
    : `estribos ${BARS[s.no].name} c/${m(s.spacing)}`
  return `${bars}; ${st}`
}

const REASON: Record<TieColumn['reason'], string> = {
  extremo: 'extremo libre de muro',
  esquina: 'esquina',
  unión: 'unión de muros',
  vano: 'borde de vano grande',
  separación: 'intermedia por separación máxima',
  plano: 'columna dibujada en el plano',
}

const LINEAR: Record<LinearElement['kind'], string> = {
  footing: 'Viga de cimentación',
  plinth: 'Sobrecimiento',
  beam: 'Viga de amarre',
  lintel: 'Dintel',
}

function linearCard(e: LinearElement): ElementCard {
  const len = distance(e.start, e.end)
  const lines = [
    `Sección ${m(e.width)} × ${m(e.height)} m, largo ${m(len)} m`,
    `Concreto: ${m(e.width * e.height * len, 3)} m³`,
    e.rebar ? `Refuerzo: ${rebarText(e.rebar)}` : 'Concreto ciclópeo, sin refuerzo',
  ]
  if (e.kind === 'footing') lines.push(`Fondo a ${m(-e.bottom)} m bajo el piso, sobre solado de 5 cm`)
  return { title: `${LINEAR[e.kind]} ${e.id}`, lines }
}

export function describeElement(s: Structure, id: string, bricks: Brick[] = []): ElementCard | null {
  const c = s.columns.find((x) => x.id === id)
  if (c)
    return {
      title: `Columneta ${c.id}`,
      lines: [
        `Ubicación: ${REASON[c.reason]}`,
        `Sección ${m(c.across)} × ${m(c.along)} m, alto ${m(c.height)} m`,
        `Concreto: ${m(c.across * c.along * c.height, 3)} m³`,
        `Refuerzo: ${rebarText(c.rebar)}`,
        'Se funde después de levantar el muro, contra el endentado del ladrillo',
      ],
    }
  const e = [...s.footings, ...s.plinths, ...s.beams, ...s.lintels].find((x) => x.id === id)
  if (e) return linearCard(e)
  const p = s.panels.find((x) => x.id === id)
  if (p) {
    const unit = BRICKS[s.settings.brick]
    const mine = bricks.filter((b) => b.panelId === p.id)
    const courses = new Set(mine.map((b) => b.course)).size
    return {
      title: `${p.confined ? 'Muro confinado' : 'Tabique'} ${p.id}`,
      lines: [
        `Largo ${m(p.to - p.from)} m, alto ${m(p.top - p.bottom)} m`,
        `${mine.length} piezas (${mine.filter((b) => b.cut).length} cortadas), ${courses} hiladas`,
        `Unidad: ${unit.name}, pega de ${m(unit.joint * 100, 0)} cm`,
        p.confined ? 'Trabado a soga, dejando endentado para las columnetas' : 'No estructural: no se amarra con columnetas',
      ],
    }
  }
  if (id.startsWith('placa:')) return { title: 'Placa de contrapiso', lines: ['Concreto de 8 cm sobre el relleno compactado', 'Se funde cuando la cimentación está lista'] }
  if (id.startsWith('losa:')) return { title: 'Losa de entrepiso', lines: ['Concreto de 12 cm sobre las vigas de amarre', 'Deja el hueco de la escalera'] }
  return null
}

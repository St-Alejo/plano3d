/**
 * Secuencia constructiva de una casa en mampostería confinada, en el orden de la obra: nada
 * se apoya sobre algo que todavía no está construido. Cada paso tiene un id estable que la
 * escena 3D usa para mostrar u ocultar sus piezas (`userData.step`).
 */
import type { BuildingModel } from '@/api/types'
import type { Structure } from './derive'
import type { Brick } from './masonryLayout'
import { barWeight, rebarSchedule } from './rebar'

export interface Step {
  id: string
  title: string
  /** qué hace el maestro en este paso, con las cantidades */
  detail: string
  levelId?: string
}

/** Ids de los pasos: la escena de obra etiqueta cada malla con uno de estos. */
export const STEP = {
  terreno: 'terreno',
  solado: 'solado',
  aceroCimentacion: 'acero-cimentacion',
  cimentacion: 'cimentacion',
  sobrecimiento: 'sobrecimiento',
  placa: 'placa',
  muros: (levelId: string) => `muros:${levelId}`,
  aceroColumnas: (levelId: string) => `acero-columnas:${levelId}`,
  columnas: (levelId: string) => `columnas:${levelId}`,
  aceroVigas: (levelId: string) => `acero-vigas:${levelId}`,
  vigas: (levelId: string) => `vigas:${levelId}`,
  /** losa que se funde sobre las vigas del piso de abajo y sirve de piso a `levelId` */
  losa: (levelId: string) => `losa:${levelId}`,
} as const

const m = (v: number, digits = 1) => v.toFixed(digits).replace('.', ',')
const n = (v: number) => v.toLocaleString('es-CO')

export function constructionSchedule(model: BuildingModel, s: Structure, bricks: Brick[]): Step[] {
  const levels = [...model.levels].sort((a, b) => a.elevation - b.elevation)
  const bars = rebarSchedule(s)
  const kg = (ids: Set<string>) => bars.filter((b) => ids.has(b.elementId)).reduce((a, b) => a + barWeight(b), 0)
  const ids = (list: { id: string }[]) => new Set(list.map((e) => e.id))
  const footingLength = s.footings.reduce((a, f) => a + Math.hypot(f.end.x - f.start.x, f.end.y - f.start.y), 0)

  const steps: Step[] = [
    {
      id: STEP.terreno,
      title: 'Replanteo y excavación',
      detail: `Se limpia el lote, se marcan los ejes con estacas e hilos y se excavan ${m(footingLength)} m de zanja hasta ${m(-(s.footings[0]?.bottom ?? 0) + 0.05, 2)} m de profundidad.`,
    },
    { id: STEP.solado, title: 'Solado de limpieza', detail: 'Concreto pobre de 5 cm en el fondo de la zanja: el acero no toca la tierra.' },
    {
      id: STEP.aceroCimentacion,
      title: 'Acero de la cimentación',
      detail: `Se arman las canastas de las vigas de cimentación (${m(kg(ids(s.footings)))} kg) y se dejan los arranques de las columnetas.`,
    },
    { id: STEP.cimentacion, title: 'Concreto de la cimentación', detail: `Se funden ${s.footings.length} vigas de cimentación, vibrando para que no queden hormigueros.` },
    { id: STEP.sobrecimiento, title: 'Sobrecimiento', detail: 'Sobrecimiento en concreto ciclópeo hasta el nivel del piso, con impermeabilización encima.' },
    { id: STEP.placa, title: 'Placa de contrapiso', detail: 'Relleno compactado y placa de 8 cm de concreto.' },
  ]

  levels.forEach((lv, i) => {
    const name = lv.name || `piso ${i + 1}`
    if (i > 0) steps.push({ id: STEP.losa(lv.id), levelId: lv.id, title: `Losa de ${name}`, detail: 'Formaleta y puntales, acero de la losa y concreto de 12 cm; se deja el hueco de la escalera.' })
    const mine = bricks.filter((b) => b.levelId === lv.id)
    if (mine.length > 0) {
      const courses = new Set(mine.map((b) => b.course)).size
      steps.push({
        id: STEP.muros(lv.id),
        levelId: lv.id,
        title: `Muros de ${name}`,
        detail: `${courses} hiladas, ${n(mine.length)} ladrillos (${n(mine.filter((b) => b.cut).length)} cortados). Se levantan a plomo y nivel, dejando endentado donde van las columnetas.`,
      })
    }
    const cols = s.columns.filter((c) => c.levelId === lv.id)
    if (cols.length > 0) {
      steps.push({ id: STEP.aceroColumnas(lv.id), levelId: lv.id, title: `Acero de columnetas de ${name}`, detail: `${cols.length} canastas de 4 barras con sus estribos (${m(kg(ids(cols)))} kg), amarradas a los arranques.` })
      steps.push({ id: STEP.columnas(lv.id), levelId: lv.id, title: `Columnetas de ${name}`, detail: 'Formaleta contra el ladrillo y concreto: la columneta queda trabada con el muro.' })
    }
    const linear = [...s.beams, ...s.lintels].filter((b) => b.levelId === lv.id)
    if (linear.length > 0) {
      steps.push({ id: STEP.aceroVigas(lv.id), levelId: lv.id, title: `Acero de vigas de ${name}`, detail: `Canastas de vigas de amarre y dinteles (${m(kg(ids(linear)))} kg), pasando por dentro de las columnetas.` })
      steps.push({ id: STEP.vigas(lv.id), levelId: lv.id, title: `Vigas de amarre de ${name}`, detail: 'Se funden las vigas de amarre y los dinteles: amarran todos los muros en un solo anillo.' })
    }
  })
  return steps
}

/**
 * Textos y datos de las secciones de la landing que no son componentes (se comparten con
 * las pruebas y así no rompen el refresco en caliente).
 */
import { STAGES as PIPELINE } from '@/features/processing/progressState'

const stage = (key: string) => PIPELINE.find((s) => s.key === key)?.title.toLowerCase() ?? key

/** Etapas del análisis que se nombran en «Cómo funciona»: las que el usuario reconoce en su plano. */
export const NAMED_STAGES = ['walls', 'scale', 'openings', 'rooms'].map(stage)

export const HOW_STEPS = [
  { title: 'Toma la foto', text: 'Desde arriba, con la hoja completa. La perspectiva se corrige sola; también sirve un PDF o un DXF.' },
  {
    title: 'La app la lee',
    text: `En ${PIPELINE.length} etapas: ${NAMED_STAGES.slice(0, -1).join(', ')} y ${NAMED_STAGES.at(-1)}. Las ves avanzar en vivo.`,
  },
  { title: 'Corrige y recorre', text: 'Ajusta lo que haga falta con el ratón o escribiendo, y camina tu casa en 3D.' },
] as const

export const FORMATS = [
  { name: 'Foto o escaneo', how: 'Vectoriza los muros y lee las cotas escritas (OCR) para ajustar el plano a ellas.', size: 'Exactas donde hay cotas; el resto, inferidas con su margen de error.' },
  { name: 'Varias fotos', how: 'Une las fotos de un plano grande en una sola imagen antes de analizarla.', size: 'Igual que una foto.' },
  { name: 'PDF de CAD', how: 'Toma las líneas y curvas del vector; la escala sale de las cotas o del rótulo ESC 1:N.', size: 'Exactas.' },
  { name: 'DXF', how: 'Lee capas, bloques de puertas y ventanas, arcos y las entidades de cota.', size: 'Exactas: las del archivo.' },
] as const

/**
 * Colores de cota del editor (`DIM_COLORS` en editor2d/PlanElements). Se repiten aquí para no
 * cargar Konva en la landing; una prueba comprueba que coinciden.
 */
export const DIM_SAMPLES = [
  { status: 'exact', label: 'Exacta', text: 'leída del plano y confirmada', value: '3,20', color: '#2e7d4f' },
  { status: 'inferred', label: 'Por verificar', text: 'inferida del dibujo', value: '2,85', color: '#6b7280' },
  { status: 'conflict', label: 'En conflicto', text: 'el dibujo no cuadra con la cota', value: '4,10', color: '#c0392b' },
] as const

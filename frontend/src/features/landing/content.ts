/**
 * Textos y datos de las secciones de la landing que no son componentes (se comparten con
 * las pruebas y así no rompen el refresco en caliente).
 */
import { MAX_MB } from '@/features/capture/validateFile'
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

export const FAQ = [
  {
    q: '¿Qué tan exactas son las medidas?',
    a: 'Con un DXF o un PDF de CAD, las del archivo. Con una foto, exactas donde el plano tiene cotas escritas; el resto queda marcado por verificar, y puedes calibrar trazando una cota que conozcas.',
  },
  { q: '¿Qué archivos puedo subir?', a: `Fotos JPG, PNG o WEBP, PDF y DXF, de hasta ${MAX_MB} MB. Un plano grande puede ir en varias fotos.` },
  { q: '¿Funciona en el celular?', a: 'Sí. Tomas la foto con la cámara desde la misma página, y el recorrido en 3D se maneja con un joystick en la pantalla.' },
  { q: '¿Cuánto cuesta?', a: 'Nada. Plano 3D es el proyecto final de un curso de Programación Orientada a Objetos y se usa libremente.' },
  {
    q: '¿Qué pasa con mis planos?',
    a: 'Se guardan en el servidor de la app para que puedas seguir editándolos; esta versión de demostración los borra cuando se reinicia. Si la lectura con IA está activa, la imagen se envía a Claude solo para leer las cotas.',
  },
  { q: '¿Qué puedo exportar?', a: 'El modelo en GLB u OBJ (se abren en Blender), imágenes PNG del 3D, y el cuadro de áreas y las cantidades de obra en CSV.' },
  {
    q: '¿Sirven las cantidades para comprar?',
    a: 'Para presupuestar, sí: siguen la NSR-10 (Título E) e incluyen desperdicio. Usan dosificaciones típicas y no reemplazan el diseño de un ingeniero; confírmalas antes de construir.',
  },
] as const

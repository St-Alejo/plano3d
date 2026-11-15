// Preguntas frecuentes que tenía la landing (quitadas el 2026-11-15 a pedido). MAX_MB era 25.
const MAX_MB = 25

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

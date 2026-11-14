/** Catálogo de las fotos de la marca (public/images) y la ruta de cada tamaño. */
export const PHOTOS = {
  'etapa-1-plano': { w: 1672, h: 941, alt: 'El plano impreso de la casa sobre una mesa de dibujo, con escalímetro y lápiz' },
  'etapa-2-cimentacion': { w: 1672, h: 941, alt: 'El lote con las zanjas, las vigas de cimentación y los hierros de arranque de las columnas' },
  'etapa-3-muros': { w: 1672, h: 941, alt: 'Los muros de ladrillo del primer piso a media altura, con sus columnas de confinamiento' },
  'etapa-4-estructura': { w: 1672, h: 941, alt: 'La casa de tres pisos en obra gris: ladrillo, columnas, vigas y losas, con andamio' },
  'etapa-5-acabados': { w: 1672, h: 941, alt: 'La casa terminada: fachada blanca con un volumen de ladrillo, balcón de vidrio y portón de madera' },
  'etapa-6-hogar': { w: 1672, h: 941, alt: 'La misma casa al anochecer, con las luces de adentro encendidas' },
  'interior-sala': { w: 1122, h: 1402, alt: 'La sala y el comedor de la casa, con luz natural y muebles de madera clara' },
  materiales: { w: 1586, h: 992, alt: 'Muro de ladrillo con su columna de concreto y los hierros a la vista, junto a un bulto de cemento' },
  'cierre-calle': { w: 1916, h: 821, alt: 'La calle con la casa terminada y sus vecinas al atardecer' },
  'vacio-proyectos': { w: 1254, h: 1254, alt: 'Una mesa de dibujo con una hoja en blanco, escalímetro, lápiz y escuadra' },
  'nuevo-plano': { w: 1122, h: 1402, alt: 'Planos enrollados, un casco de obra, un flexómetro y un café sobre una mesa, frente a una obra de ladrillo' },
  'no-encontrado': { w: 1672, h: 941, alt: 'Un pasillo en obra gris, de ladrillo y columnas de concreto, que termina en un muro' },
} as const

export type PhotoName = keyof typeof PHOTOS

export const WIDTHS = [640, 1280, 1920] as const

export const photoSrc = (name: PhotoName, w: (typeof WIDTHS)[number] = 1280) => `/images/${name}-${w}.webp`

/** Catálogo de las fotos de la marca (public/images) y la ruta de cada tamaño. */
export const PHOTOS = {
  'etapa-1-plano': { w: 1672, h: 941, alt: 'El plano impreso de la casa sobre una mesa de dibujo, con escalímetro y lápiz' },
  'etapa-2-cimentacion': { w: 1672, h: 941, alt: 'El lote con las zanjas, las vigas de cimentación y los hierros de arranque de las columnas' },
  'etapa-3-muros': { w: 1672, h: 941, alt: 'Los muros de ladrillo del primer piso a media altura, con sus columnas de confinamiento' },
  'etapa-4-estructura': { w: 1672, h: 941, alt: 'La casa de tres pisos en obra gris: ladrillo, columnas, vigas y losas, con andamio' },
  'etapa-5-acabados': { w: 1672, h: 941, alt: 'La casa terminada: fachada blanca con un volumen de ladrillo, balcón de vidrio y portón de madera' },
  'etapa-6-hogar': { w: 1672, h: 941, alt: 'La misma casa al anochecer, con las luces de adentro encendidas' },
  // recorrido del hero: la misma calle con la misma cámara, alineadas píxel a píxel (scripts/align_hero.py)
  'hero-01-etapa-1-plano': { w: 1920, h: 1080, alt: 'El plano impreso de la casa sobre una mesa de dibujo' },
  'hero-02-obra-01-replanteo': { w: 1920, h: 1080, alt: 'El lote vacío con estacas e hilos que marcan los ejes de la casa' },
  'hero-03-etapa-2-cimentacion': { w: 1920, h: 1080, alt: 'Las zanjas de la cimentación con el acero de arranque de las columnas' },
  'hero-04-obra-02-cimiento-fundido': { w: 1920, h: 1080, alt: 'Las vigas de cimentación ya fundidas y la primera hilada de ladrillo' },
  'hero-05-etapa-3-muros': { w: 1920, h: 1080, alt: 'Los muros de ladrillo del primer piso a media altura' },
  'hero-06-obra-03-losa': { w: 1920, h: 1080, alt: 'El primer piso cerrado con la formaleta de la losa sobre puntales' },
  'hero-07-obra-04-segundo-piso': { w: 1920, h: 1080, alt: 'Dos pisos en obra gris con andamio y el acero del tercero' },
  'hero-08-etapa-4-estructura': { w: 1920, h: 1080, alt: 'Los tres pisos en obra gris: ladrillo, columnas, vigas y losas' },
  'hero-09-obra-05-panete': { w: 1920, h: 1080, alt: 'La fachada a medio pañetar, con andamio y malla de obra' },
  'hero-10-obra-06-pintura': { w: 1920, h: 1080, alt: 'La fachada pintándose, con las ventanas aún con su plástico protector' },
  'hero-11-etapa-5-acabados': { w: 1920, h: 1080, alt: 'La casa terminada de día, con portón de madera y balcón de vidrio' },
  'hero-12-obra-07-hora-dorada': { w: 1920, h: 1080, alt: 'La casa terminada con la luz dorada del atardecer' },
  'hero-13-etapa-6-hogar': { w: 1920, h: 1080, alt: 'La casa al anochecer, con las luces de adentro encendidas' },
  'hero-13-hogar-apagado': { w: 1920, h: 1080, alt: 'La casa al anochecer con todas las luces apagadas' },
  // recorrido por dentro
  'interior-umbral-cerrada': { w: 1672, h: 941, alt: 'La puerta principal de madera cerrada, de noche' },
  'interior-terraza-apagada': { w: 1671, h: 941, alt: 'La terraza al anochecer con las guirnaldas apagadas' },
  'interior-umbral': { w: 1672, h: 941, alt: 'La puerta principal de madera entreabierta de noche, con la luz del hall saliendo' },
  'interior-entrada': { w: 1671, h: 941, alt: 'El hall de entrada con la escalera de madera flotante y un muro de ladrillo' },
  'interior-comedor': { w: 1672, h: 941, alt: 'La sala-comedor en doble altura con un ventanal al patio y las montañas' },
  'interior-cocina': { w: 1672, h: 941, alt: 'La cocina con isla de madera, mesón de piedra y lámparas colgantes' },
  'interior-alcoba': { w: 1672, h: 941, alt: 'La alcoba principal con muro de ladrillo y un ventanal al balcón al amanecer' },
  'interior-terraza': { w: 1671, h: 941, alt: 'La terraza de la azotea al anochecer, con guirnaldas de luz y el valle de fondo' },
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

/**
 * Catálogo paramétrico de muebles (ADR-016). Cada pieza es una lista de volúmenes
 * simples en coordenadas locales; de esa misma definición salen el símbolo en planta
 * (vista superior de las partes) y el volumen 3D. Sin modelos externos.
 *
 * Coordenadas locales: x a lo ancho (centrado), z a lo profundo (centrado; el frente
 * en +z), y hacia arriba desde el piso.
 */

export type Tone = 'wood' | 'soft' | 'fabric' | 'white' | 'metal' | 'dark' | 'glass' | 'plant'

export interface Part {
  shape: 'box' | 'cyl'
  /** centro en planta (local) */
  x: number
  z: number
  /** ancho (x) y fondo (z); en cilindros, w es el diámetro */
  w: number
  d: number
  /** base y alto */
  y0: number
  h: number
  tone: Tone
}

export interface CatalogItem {
  id: string
  name: string
  category: 'Alcoba' | 'Sala' | 'Comedor' | 'Cocina' | 'Baño' | 'Estudio' | 'Otros'
  width: number
  depth: number
  height: number
  parts: Part[]
}

const box = (x: number, z: number, w: number, d: number, y0: number, h: number, tone: Tone): Part => ({ shape: 'box', x, z, w, d, y0, h, tone })
const cyl = (x: number, z: number, diam: number, y0: number, h: number, tone: Tone): Part => ({ shape: 'cyl', x, z, w: diam, d: diam, y0, h, tone })

function bed(id: string, name: string, w: number): CatalogItem {
  const d = 1.95
  const pillows = w > 1.2 ? [box(-w / 4, -d / 2 + 0.3, w / 2 - 0.12, 0.35, 0.55, 0.1, 'white'), box(w / 4, -d / 2 + 0.3, w / 2 - 0.12, 0.35, 0.55, 0.1, 'white')] : [box(0, -d / 2 + 0.3, w - 0.2, 0.35, 0.55, 0.1, 'white')]
  return {
    id,
    name,
    category: 'Alcoba',
    width: w,
    depth: d,
    height: 1,
    parts: [box(0, 0.04, w, d - 0.08, 0, 0.35, 'wood'), box(0, 0.06, w - 0.04, d - 0.16, 0.35, 0.2, 'soft'), box(0, -d / 2 + 0.04, w, 0.08, 0, 1, 'wood'), ...pillows],
  }
}

function sofa(id: string, name: string, w: number): CatalogItem {
  const d = 0.9
  return {
    id,
    name,
    category: 'Sala',
    width: w,
    depth: d,
    height: 0.82,
    parts: [
      box(0, 0.05, w - 0.3, d - 0.2, 0, 0.42, 'fabric'),
      box(0, -d / 2 + 0.1, w, 0.2, 0, 0.82, 'fabric'),
      box(-w / 2 + 0.08, 0, 0.16, d, 0, 0.6, 'fabric'),
      box(w / 2 - 0.08, 0, 0.16, d, 0, 0.6, 'fabric'),
    ],
  }
}

export const CATALOG: CatalogItem[] = [
  bed('cama_doble', 'Cama doble (1,40)', 1.4),
  bed('cama_sencilla', 'Cama sencilla (1,00)', 1.0),
  {
    id: 'mesa_noche',
    name: 'Mesa de noche',
    category: 'Alcoba',
    width: 0.45,
    depth: 0.4,
    height: 0.5,
    parts: [box(0, 0, 0.45, 0.4, 0, 0.5, 'wood')],
  },
  {
    id: 'closet',
    name: 'Clóset',
    category: 'Alcoba',
    width: 1.6,
    depth: 0.6,
    height: 2.2,
    parts: [box(0, 0, 1.6, 0.6, 0, 2.2, 'wood'), box(0, 0.301, 0.02, 0.01, 0.1, 2.0, 'dark')],
  },
  sofa('sofa_3', 'Sofá de 3 puestos', 2.0),
  sofa('sofa_2', 'Sofá de 2 puestos', 1.5),
  sofa('sillon', 'Sillón', 0.85),
  {
    id: 'mesa_centro',
    name: 'Mesa de centro',
    category: 'Sala',
    width: 1.0,
    depth: 0.55,
    height: 0.4,
    parts: [box(0, 0, 1.0, 0.55, 0.36, 0.04, 'wood'), box(0, 0, 0.9, 0.45, 0, 0.36, 'dark')],
  },
  {
    id: 'mueble_tv',
    name: 'Mueble de TV',
    category: 'Sala',
    width: 1.6,
    depth: 0.4,
    height: 1.2,
    parts: [box(0, 0, 1.6, 0.4, 0, 0.5, 'wood'), box(0, -0.12, 1.2, 0.05, 0.55, 0.65, 'dark')],
  },
  {
    id: 'tapete',
    name: 'Tapete',
    category: 'Sala',
    width: 2.0,
    depth: 1.4,
    height: 0.01,
    parts: [box(0, 0, 2.0, 1.4, 0, 0.01, 'fabric')],
  },
  {
    id: 'comedor_4',
    name: 'Comedor de 4 puestos',
    category: 'Comedor',
    width: 1.2,
    depth: 1.6,
    height: 0.9,
    parts: [
      box(0, 0, 1.2, 0.8, 0.72, 0.04, 'wood'),
      box(0, 0, 1.0, 0.6, 0, 0.72, 'dark'),
      ...[-0.3, 0.3].flatMap((x) => [box(x, -0.6, 0.42, 0.42, 0, 0.45, 'wood'), box(x, -0.79, 0.42, 0.04, 0.45, 0.45, 'wood'), box(x, 0.6, 0.42, 0.42, 0, 0.45, 'wood'), box(x, 0.79, 0.42, 0.04, 0.45, 0.45, 'wood')]),
    ],
  },
  {
    id: 'cocina_lineal',
    name: 'Cocina lineal',
    category: 'Cocina',
    width: 2.4,
    depth: 0.6,
    height: 0.91,
    parts: [box(0, 0, 2.4, 0.6, 0, 0.86, 'white'), box(0, 0, 2.4, 0.6, 0.86, 0.04, 'dark'), box(0.6, 0, 0.6, 0.5, 0.9, 0.01, 'metal'), box(-0.6, 0, 0.5, 0.4, 0.84, 0.07, 'metal')],
  },
  {
    id: 'nevera',
    name: 'Nevera',
    category: 'Cocina',
    width: 0.7,
    depth: 0.7,
    height: 1.8,
    parts: [box(0, 0, 0.7, 0.7, 0, 1.8, 'metal')],
  },
  {
    id: 'sanitario',
    name: 'Sanitario',
    category: 'Baño',
    width: 0.4,
    depth: 0.7,
    height: 0.78,
    parts: [box(0, -0.27, 0.4, 0.16, 0, 0.78, 'white'), cyl(0, 0.08, 0.38, 0, 0.42, 'white')],
  },
  {
    id: 'lavamanos',
    name: 'Lavamanos',
    category: 'Baño',
    width: 0.55,
    depth: 0.45,
    height: 0.85,
    parts: [box(0, 0, 0.55, 0.45, 0, 0.8, 'white'), cyl(0, 0.03, 0.36, 0.8, 0.05, 'white')],
  },
  {
    id: 'ducha',
    name: 'Ducha',
    category: 'Baño',
    width: 0.9,
    depth: 0.9,
    height: 2.0,
    parts: [box(0, 0, 0.9, 0.9, 0, 0.05, 'white'), box(0, 0.44, 0.9, 0.02, 0.05, 1.95, 'glass')],
  },
  {
    id: 'lavadora',
    name: 'Lavadora',
    category: 'Otros',
    width: 0.6,
    depth: 0.6,
    height: 0.85,
    parts: [box(0, 0, 0.6, 0.6, 0, 0.85, 'white'), box(0, 0.295, 0.35, 0.01, 0.25, 0.35, 'dark')],
  },
  {
    id: 'escritorio',
    name: 'Escritorio',
    category: 'Estudio',
    width: 1.2,
    depth: 0.6,
    height: 0.75,
    parts: [box(0, 0, 1.2, 0.6, 0.72, 0.03, 'wood'), box(-0.58, 0, 0.04, 0.6, 0, 0.72, 'wood'), box(0.58, 0, 0.04, 0.6, 0, 0.72, 'wood')],
  },
  {
    id: 'silla',
    name: 'Silla',
    category: 'Estudio',
    width: 0.45,
    depth: 0.5,
    height: 0.9,
    parts: [box(0, 0.03, 0.45, 0.44, 0, 0.46, 'dark'), box(0, -0.23, 0.45, 0.04, 0.46, 0.44, 'dark')],
  },
  {
    id: 'planta',
    name: 'Planta',
    category: 'Otros',
    width: 0.4,
    depth: 0.4,
    height: 1.1,
    parts: [cyl(0, 0, 0.32, 0, 0.35, 'dark'), cyl(0, 0, 0.4, 0.35, 0.75, 'plant')],
  },
]

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((c) => c.id === id)
}

/** Escala de las partes cuando el mueble se redimensiona respecto de su medida de catálogo. */
export function scaledParts(item: CatalogItem, width: number, depth: number, height: number): Part[] {
  const sx = width / item.width
  const sz = depth / item.depth
  const sy = height / item.height
  return item.parts.map((p) => ({ ...p, x: p.x * sx, z: p.z * sz, w: p.w * sx, d: p.d * sz, y0: p.y0 * sy, h: p.h * sy }))
}

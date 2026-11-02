/**
 * Apartamento de muestra para la landing: tipología VIS colombiana de ~50 m² útiles
 * (sala-comedor, cocina, dos alcobas y baño). Es un BuildingModel normal, así que
 * el hero lo arma con el mismo SceneBuilder del visor y la tabla de áreas lo mide
 * con las mismas funciones del dominio.
 */
import type { BuildingModel, Furniture, Opening, Room, Wall } from '@/api/types'
import { catalogItem } from '@/domain/catalog'

const EXT = 0.2
const INT = 0.12

function w(id: string, x1: number, y1: number, x2: number, y2: number, thickness: number, openings: Opening[] = []): Wall {
  return {
    id,
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness,
    height: 2.4,
    material: 'plaster',
    openings,
    confidence: 1,
  }
}

const door = (id: string, offset: number, width = 0.85): Opening => ({
  id,
  kind: 'door',
  offset,
  width,
  height: 2.05,
  sill: 0,
  confidence: 1,
})

const win = (id: string, offset: number, width: number, sill = 0.95, height = 1.2): Opening => ({
  id,
  kind: 'window',
  offset,
  width,
  height,
  sill,
  confidence: 1,
})

function room(id: string, label: string, pts: [number, number][]): Room {
  return { id, label, confidence: 1, polygon: pts.map(([x, y]) => ({ x, y })) }
}

/** Rotaciones: 0 = respaldo al norte; los muebles miran hacia el centro del ambiente. */
const N = 0
const S = Math.PI
const E = Math.PI / 2
const O = -Math.PI / 2

let seq = 0
/** Mueble del catálogo con sus medidas de catálogo (o un ancho propio), centrado en (x, y). */
function f(catalogId: string, x: number, y: number, rotation: number, width?: number): Furniture {
  const item = catalogItem(catalogId)!
  return { id: `m_${++seq}`, catalog_id: catalogId, position: { x, y }, rotation, width: width ?? item.width, depth: item.depth, height: item.height }
}

/** Amoblado típico: sala con TV y comedor junto a la entrada, cocina lineal, dos alcobas y baño. */
function furnish(): Furniture[] {
  seq = 0
  return [
    // sala-comedor: el sofá contra el muro oeste mira al televisor; el comedor junto a la entrada
    f('tapete', 2.45, 2.9, E),
    f('sofa_3', 0.58, 2.9, O),
    f('mesa_centro', 1.75, 2.9, E),
    f('mueble_tv', 4.5, 2.9, E),
    f('planta', 0.45, 0.45, N),
    f('planta', 4.4, 0.45, N),
    f('comedor_4', 3.45, 4.75, N),
    // cocina
    f('cocina_lineal', 1.3, 6.18, S, 2.3),
    f('nevera', 0.5, 4.26, N),
    // alcoba principal
    f('cama_doble', 7.3, 1.7, E),
    f('mesa_noche', 8.05, 0.62, E),
    f('mesa_noche', 8.05, 2.78, E),
    f('closet', 5.95, 3.03, S),
    // alcoba 2
    f('cama_sencilla', 5.85, 5.6, E),
    f('escritorio', 6.53, 4.05, E, 1.0),
    f('silla', 6.0, 4.05, O),
    // baño
    f('ducha', 7.82, 6.02, S),
    f('sanitario', 7.98, 4.75, E),
    f('lavamanos', 7.22, 5.0, O),
  ]
}

/** Ancho y fondo del apartamento (ejes de muros exteriores), en metros. */
export const APT_W = 8.4
export const APT_D = 6.6

export function sampleApartment(): BuildingModel {
  const e = EXT / 2
  const i = INT / 2
  return {
    project_id: 'muestra',
    scale: { meters_per_pixel: 0.01, source: 'calibrated', confidence: 1 },
    levels: [
      {
        id: 'lvl_0',
        name: 'Planta tipo',
        elevation: 0,
        height: 2.4,
        furniture: furnish(),
        walls: [
          w('ext_n', 0, 0, APT_W, 0, EXT, [win('v_sala', 1.0, 2.2), win('v_alc1', 5.8, 1.6)]),
          w('ext_e', APT_W, 0, APT_W, APT_D, EXT, [win('v_bano', 4.4, 0.6, 1.5, 0.6)]),
          w('ext_s', APT_W, APT_D, 0, APT_D, EXT, [win('v_alc2', 2.0, 1.2), door('p_acceso', 4.25, 0.95)]),
          w('ext_o', 0, APT_D, 0, 0, EXT, [win('v_coc', 0.9, 1.1, 1.1, 1.0)]),
          w('int_eje', 4.8, 0, 4.8, APT_D, INT, [door('p_alc1', 1.2), door('p_alc2', 4.4)]),
          w('int_alc', 4.8, 3.4, APT_W, 3.4, INT, [door('p_bano', 2.4, 0.75)]),
          w('int_bano', 6.9, 3.4, 6.9, APT_D, INT),
          w('int_coc_n', 0, 3.8, 1.5, 3.8, INT),
          w('int_coc_e', 2.6, 3.8, 2.6, APT_D, INT),
        ],
        rooms: [
          room('r_sala', 'Sala-comedor', [
            [e, e],
            [4.8 - i, e],
            [4.8 - i, APT_D - e],
            [2.6 + i, APT_D - e],
            [2.6 + i, 3.8 - i],
            [e, 3.8 - i],
          ]),
          room('r_coc', 'Cocina', [
            [e, 3.8 + i],
            [2.6 - i, 3.8 + i],
            [2.6 - i, APT_D - e],
            [e, APT_D - e],
          ]),
          room('r_alc1', 'Alcoba principal', [
            [4.8 + i, e],
            [APT_W - e, e],
            [APT_W - e, 3.4 - i],
            [4.8 + i, 3.4 - i],
          ]),
          room('r_alc2', 'Alcoba 2', [
            [4.8 + i, 3.4 + i],
            [6.9 - i, 3.4 + i],
            [6.9 - i, APT_D - e],
            [4.8 + i, APT_D - e],
          ]),
          room('r_bano', 'Baño', [
            [6.9 + i, 3.4 + i],
            [APT_W - e, 3.4 + i],
            [APT_W - e, APT_D - e],
            [6.9 + i, APT_D - e],
          ]),
        ],
      },
    ],
  }
}

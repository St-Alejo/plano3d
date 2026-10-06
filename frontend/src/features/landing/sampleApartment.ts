/**
 * Apartamento de muestra para la landing: tipología VIS colombiana de ~50 m² útiles
 * (sala-comedor, cocina, dos alcobas y baño). Es un BuildingModel normal, así que
 * el hero lo arma con el mismo SceneBuilder del visor y la tabla de áreas lo mide
 * con las mismas funciones del dominio.
 */
import type { BuildingModel, Opening, Room, Wall } from '@/api/types'

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

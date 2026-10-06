import type { BuildingModel, Opening, Project, Room, Wall } from '@/api/types'

export function wall(id: string, x1: number, y1: number, x2: number, y2: number, openings: Opening[] = []): Wall {
  return {
    id,
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness: 0.2,
    height: 2.6,
    material: 'plaster',
    openings,
    confidence: 0.9,
  }
}

export function door(id: string, offset: number, width = 0.9): Opening {
  return { id, kind: 'door', offset, width, height: 2.1, sill: 0, confidence: 0.8 }
}

export function windowOp(id: string, offset: number, width = 1.2): Opening {
  return { id, kind: 'window', offset, width, height: 1.2, sill: 0.9, confidence: 0.8 }
}

export function rect(id: string, label: string, x0: number, y0: number, x1: number, y1: number, confidence = 0.9): Room {
  return {
    id,
    label,
    confidence,
    polygon: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  }
}

/** Departamento 10×7 m: dos ambientes, una puerta interior y una ventana. */
export function sampleModel(): BuildingModel {
  return {
    project_id: 'prj_1',
    scale: { meters_per_pixel: 0.02, source: 'estimated', confidence: 0.35 },
    source_image: { key: 'rectified/prj_1.png', width_px: 600, height_px: 450 },
    levels: [
      {
        id: 'lvl_0',
        name: 'Planta baja',
        elevation: 0,
        walls: [
          wall('w_top', 0, 0, 10, 0, [windowOp('o_win', 2)]),
          wall('w_right', 10, 0, 10, 7),
          wall('w_bottom', 10, 7, 0, 7),
          wall('w_left', 0, 7, 0, 0),
          wall('w_mid', 6, 0, 6, 7, [door('o_door', 3)]),
        ],
        rooms: [rect('r_a', 'Sala', 0.1, 0.1, 5.9, 6.9, 0.85), rect('r_b', 'Espacio 2', 6.1, 0.1, 9.9, 6.9, 0.45)],
      },
    ],
  }
}

export function sampleProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'prj_1',
    name: 'Depto centro',
    status: 'ready',
    error: null,
    created_at: '2026-09-29T10:00:00Z',
    updated_at: '2026-09-29T10:01:00Z',
    total_area: 60.3,
    room_count: 2,
    model: sampleModel(),
    revision: 1,
    ...overrides,
  }
}

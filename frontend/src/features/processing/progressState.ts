import type { BuildingModel, ProgressEvent } from '@/api/types'

export const STAGES: { key: string; title: string }[] = [
  { key: 'ingest', title: 'Lectura de la imagen' },
  { key: 'layout', title: 'Análisis de la lámina' },
  { key: 'rectify', title: 'Corrección de perspectiva' },
  { key: 'preprocess', title: 'Limpieza y binarización' },
  { key: 'walls', title: 'Detección de muros' },
  { key: 'vectorize', title: 'Vectorización' },
  { key: 'scale', title: 'Estimación de escala' },
  { key: 'openings', title: 'Puertas y ventanas' },
  { key: 'topology', title: 'Topología de muros' },
  { key: 'rooms', title: 'Segmentación de ambientes' },
  { key: 'room_names', title: 'Nombres de ambientes' },
  { key: 'assemble', title: 'Ensamblado del modelo' },
]

export const METRIC_LABELS: Record<string, (v: number) => string> = {
  paper_detected: (v) => (v ? 'hoja detectada' : 'sin recorte'),
  skew_deg: (v) => `inclinación ${v.toFixed(1)}°`,
  wall_thickness_px: (v) => `grosor ${v.toFixed(0)} px`,
  segment_count: (v) => `${v} tramos`,
  meters_per_pixel: (v) => `${(v * 100).toFixed(2)} cm/px`,
  doors: (v) => `${v} puertas`,
  windows: (v) => `${v} ventanas`,
  wall_length_m: (v) => `${v.toFixed(1)} m de muro`,
  room_count: (v) => `${v} ambientes`,
  discarded_fraction: (v) => (v ? `${Math.round(v * 100)} % descartado (fotos)` : 'lámina completa'),
  named_rooms: (v) => `${v} con nombre`,
  mean_confidence: (v) => `confianza ${(v * 100).toFixed(0)}%`,
  total_area_m2: (v) => `${v.toFixed(1)} m²`,
}

type StageState = { status: 'pending' | 'started' | 'completed' | 'failed'; ms?: number; metrics?: Record<string, number>; message?: string | null }

export interface ProgressState {
  stages: Record<string, StageState>
  preview: BuildingModel | null
  done: null | 'ok' | 'failed'
  error: string | null
}

export const initialProgress: ProgressState = { stages: {}, preview: null, done: null, error: null }

export function progressReducer(state: ProgressState, e: ProgressEvent): ProgressState {
  if (e.stage === 'done') {
    return { ...state, done: e.status === 'completed' ? 'ok' : 'failed', error: e.status === 'failed' ? (e.message ?? 'Error') : null }
  }
  const prev = state.stages[e.stage]
  return {
    ...state,
    preview: e.preview ?? state.preview,
    stages: {
      ...state.stages,
      [e.stage]: {
        status: e.status,
        ms: e.elapsed_ms ?? prev?.ms,
        metrics: e.status === 'completed' ? e.metrics : prev?.metrics,
        message: e.message,
      },
    },
  }
}


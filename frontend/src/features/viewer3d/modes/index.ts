/**
 * Modos del plano (Strategy): cada modo decide qué escena se arma a partir del mismo
 * BuildingModel. Presentación es la casa terminada; los modos de obra (maestro, acero,
 * secuencia) se registran aquí a medida que existen.
 */
import type { BuildingModel } from '@/api/types'
import type { MaterialFactory } from '../scene/MaterialFactory'
import { buildScene, type BuiltScene } from '../scene/SceneBuilder'

export type PlanMode = 'presentacion' | 'obra' | 'acero' | 'secuencia'

export interface ViewModeStrategy {
  id: PlanMode
  label: string
  /** una línea para el título del botón */
  hint: string
  build(model: BuildingModel, materials: MaterialFactory): BuiltScene
}

export const presentacion: ViewModeStrategy = {
  id: 'presentacion',
  label: 'Presentación',
  hint: 'La casa terminada, con acabados y muebles',
  build: (model, materials) => buildScene(model, materials),
}

export const PLAN_MODES: ViewModeStrategy[] = [presentacion]

/** La estrategia de un id (por ejemplo `?modo=` de la URL); uno desconocido cae en Presentación. */
export function planMode(id: string | null | undefined): ViewModeStrategy {
  return PLAN_MODES.find((m) => m.id === id) ?? presentacion
}

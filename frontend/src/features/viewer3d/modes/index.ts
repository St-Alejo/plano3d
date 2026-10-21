/**
 * Modos del plano (Strategy): cada modo decide qué escena se arma a partir del mismo
 * BuildingModel. Presentación es la casa terminada; los modos de obra (maestro, acero,
 * secuencia) se registran aquí a medida que existen.
 */
import type { BuildingModel } from '@/api/types'
import type { BrickId } from '@/domain/structure/bricks'
import { deriveStructure } from '@/domain/structure/derive'
import { masonryLayout } from '@/domain/structure/masonryLayout'
import { NSR10 } from '@/domain/structure/nsr10'
import { ConstructionBuilder } from '../scene/ConstructionBuilder'
import type { MaterialFactory } from '../scene/MaterialFactory'
import { buildScene, type BuiltScene } from '../scene/SceneBuilder'

export type PlanMode = 'presentacion' | 'obra' | 'acero' | 'secuencia'

/** Ajustes de la vista que cada modo puede respetar. */
export interface ModeOptions {
  /** mostrar la cubierta (tapa los ambientes vistos desde arriba) */
  roof?: boolean
  /** calidad alta: guardaescobas, marcos, alféizares y terreno */
  realism?: boolean
  /** obra: unidad de mampostería */
  brick?: BrickId
  /** obra: ocultar el ladrillo para ver el esqueleto de concreto */
  hideMasonry?: boolean
}

export interface ViewModeStrategy {
  id: PlanMode
  label: string
  /** una línea para el título del botón */
  hint: string
  build(model: BuildingModel, materials: MaterialFactory, opts?: ModeOptions): BuiltScene
  /** altura del terreno (por defecto justo bajo el piso); la obra lo baja para ver la cimentación */
  groundY?: number
  /**
   * modos de obra: qué panel acompaña la escena (ficha de cada elemento más los controles de
   * mampostería, la cartilla de acero o la línea de tiempo); sin panel, la casa terminada
   */
  panel?: ConstructionPanel
}

export type ConstructionPanel = 'obra' | 'acero' | 'secuencia'

export const presentacion: ViewModeStrategy = {
  id: 'presentacion',
  label: 'Presentación',
  hint: 'La casa terminada, con acabados y muebles',
  build: (model, materials, opts = {}) => buildScene(model, materials, { details: opts.realism, site: opts.realism, roof: opts.roof }),
}

export const obra: ViewModeStrategy = {
  id: 'obra',
  label: 'Obra (maestro)',
  hint: 'Cimentación, columnetas, vigas y ladrillo pieza por pieza, con sus medidas',
  groundY: -(NSR10.foundationDepth + 0.1),
  panel: 'obra',
  build: (model, materials, opts = {}) => {
    const s = deriveStructure(model, { brick: opts.brick ?? 'tolete' })
    return new ConstructionBuilder(model, s, materials)
      .withFoundations()
      .withColumns()
      .withBeams()
      .withSlabs()
      .withMasonry(opts.hideMasonry ? [] : masonryLayout(model, s))
      .build()
  },
}

export const acero: ViewModeStrategy = {
  id: 'acero',
  label: 'Despiece de acero',
  hint: 'El hierro de cada elemento con su diámetro real, y la cartilla de despiece',
  groundY: obra.groundY,
  panel: 'acero',
  // concreto a rayos X: se ve cómo va el hierro por dentro
  build: (model, materials, opts = {}) =>
    new ConstructionBuilder(model, deriveStructure(model, { brick: opts.brick ?? 'tolete' }), materials, true).withFoundations().withColumns().withBeams().withRebar().build(),
}

export const secuencia: ViewModeStrategy = {
  id: 'secuencia',
  label: 'Secuencia de obra',
  hint: 'La casa construyéndose paso a paso, desde el replanteo hasta la losa',
  groundY: obra.groundY,
  panel: 'secuencia',
  // todo, acero incluido: en su paso se ve la canasta antes de que el concreto la tape
  build: (model, materials, opts = {}) => {
    const s = deriveStructure(model, { brick: opts.brick ?? 'tolete' })
    return new ConstructionBuilder(model, s, materials).withFoundations().withColumns().withBeams().withSlabs().withMasonry(masonryLayout(model, s)).withRebar().build()
  },
}

export const PLAN_MODES: ViewModeStrategy[] = [presentacion, obra, acero, secuencia]

/** La estrategia de un id (por ejemplo `?modo=` de la URL); uno desconocido cae en Presentación. */
export function planMode(id: string | null | undefined): ViewModeStrategy {
  return PLAN_MODES.find((m) => m.id === id) ?? presentacion
}

/**
 * Reglas de mampostería confinada (NSR-10, Título E: casas de uno y dos pisos) en una
 * tabla parametrizada. Son los mínimos que usa un maestro de obra para una casa típica;
 * cada valor lleva su referencia para poder revisarlo contra el texto de la norma.
 *
 * Guía didáctica: no reemplaza el diseño estructural firmado por un ingeniero.
 */

/** Designación colombiana de la barra (octavos de pulgada). */
export type BarNo = 2 | 3 | 4 | 5

export interface BarSpec {
  no: BarNo
  /** nombre comercial */
  name: string
  /** diámetro nominal en metros */
  db: number
  /** masa por metro (kg/m) */
  kgPerM: number
}

/** NSR-10 C.3.5.3 (Tabla C.3.5.3-2): diámetros y masas nominales. */
export const BARS: Record<BarNo, BarSpec> = {
  2: { no: 2, name: 'Nº2 (1/4")', db: 0.0064, kgPerM: 0.25 },
  3: { no: 3, name: 'Nº3 (3/8")', db: 0.0095, kgPerM: 0.56 },
  4: { no: 4, name: 'Nº4 (1/2")', db: 0.0127, kgPerM: 0.994 },
  5: { no: 5, name: 'Nº5 (5/8")', db: 0.0159, kgPerM: 1.552 },
}

export interface Reinforcement {
  /** barras longitudinales */
  bars: { count: number; no: BarNo }
  /** estribos cerrados: separación general y, cerca de los nudos, una más corta */
  stirrups: { no: BarNo; spacing: number; nodeSpacing?: number; nodeZone?: number }
}

export interface Section {
  /** ancho (perpendicular al muro) y alto en metros */
  width: number
  height: number
  rebar: Reinforcement
}

/** Viga de cimentación por número de pisos (NSR-10 E.2.2, Tabla E.2.2-1). */
export const FOOTING_BY_STORIES: Record<1 | 2, Section> = {
  1: { width: 0.25, height: 0.25, rebar: { bars: { count: 4, no: 3 }, stirrups: { no: 2, spacing: 0.2 } } },
  2: { width: 0.3, height: 0.3, rebar: { bars: { count: 4, no: 4 }, stirrups: { no: 2, spacing: 0.2 } } },
}

export const NSR10 = {
  /** E.4.3: área mínima de la sección de columnas y vigas de confinamiento (m²) */
  minConfinementArea: 0.02,
  /** E.4.3.4: separación máxima entre columnas de confinamiento */
  maxColumnSpacing: (t: number, clearHeight: number) => Math.min(35 * t, 1.5 * clearHeight, 4),
  /** E.4.3.2: vanos con área mayor que esta llevan columna de confinamiento a cada lado (m²) */
  openingNeedsColumns: 1.75,
  /** E.4.3.5: refuerzo de columnas de confinamiento, estribos a 10 cm en los 45 cm junto a cada nudo */
  columnRebar: { bars: { count: 4, no: 3 }, stirrups: { no: 2, spacing: 0.2, nodeSpacing: 0.1, nodeZone: 0.45 } } satisfies Reinforcement,
  /** E.4.4: vigas de amarre en cada entrepiso y en la cubierta */
  beamHeight: 0.2,
  beamRebar: { bars: { count: 4, no: 3 }, stirrups: { no: 2, spacing: 0.2, nodeSpacing: 0.1, nodeZone: 0.5 } } satisfies Reinforcement,
  /** dintel sobre puertas y ventanas: apoyo de 20 cm a cada lado */
  lintelHeight: 0.15,
  lintelBearing: 0.2,
  lintelRebar: { bars: { count: 2, no: 3 }, stirrups: { no: 2, spacing: 0.2 } } satisfies Reinforcement,
  /** C.7.7.1: recubrimiento libre; contra el suelo (con solado) 5 cm */
  cover: { column: 0.03, beam: 0.03, footing: 0.05 },
  /** C.12.15 simplificado: traslapo de barras en diámetros */
  spliceDiameters: 50,
  /** C.7.1: gancho de 90° = 12 db; gancho de estribo de 135° = 6 db, mínimo 75 mm */
  hook90: (db: number) => 12 * db,
  hook135: (db: number) => Math.max(6 * db, 0.075),
  /** largo comercial de la varilla en Colombia */
  barStock: 6,
  /** profundidad del fondo de la cimentación bajo el piso terminado y espesor del solado */
  foundationDepth: 0.6,
  leanConcrete: 0.05,
} as const

/** Lado de una columneta con ancho igual al muro y área mínima de confinamiento, redondeado a 5 cm. */
export function columnDepth(t: number): number {
  const need = NSR10.minConfinementArea / t
  return Math.max(t, Math.ceil(need / 0.05 - 1e-9) * 0.05)
}

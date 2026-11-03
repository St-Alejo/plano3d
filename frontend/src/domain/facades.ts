/**
 * Fachadas propuestas: cómo se ve la casa por fuera. Cada estilo viste solo el exterior
 * (una piel sobre la cara de afuera de los muros de fachada, marcos, franjas de losa,
 * antepecho, portón y detalles); el interior y la geometría del plano no cambian.
 *
 * La fachada es paramétrica: un estilo base más `FacadeCustom` (lo que la persona o la IA
 * le cambió encima: el revestimiento de una parte, un color, poner o quitar un detalle).
 */
import type { FacadeCustom, FacadeSurface } from '@/api/types'
import type { TextureId } from './materials'

export const FACADE_STYLES = ['moderna_blanca', 'moderna_madera', 'moderna_ladrillo', 'moderna_contemporanea'] as const
export type FacadeStyle = (typeof FACADE_STYLES)[number]

export const FACADE_MATERIALS = ['panete', 'concreto', 'ladrillo', 'madera', 'porcelanato'] as const
export type FacadeMaterial = (typeof FACADE_MATERIALS)[number]
export const FACADE_PARTS = ['ground', 'upper', 'front', 'gate'] as const
export type FacadePart = (typeof FACADE_PARTS)[number]
export const FACADE_COLORS = ['frame', 'band', 'accent'] as const
export type FacadeColor = (typeof FACADE_COLORS)[number]
export const FACADE_FEATURES = ['listones', 'jardinera', 'marco_ventana', 'alero', 'luces'] as const
export type FacadeFeature = (typeof FACADE_FEATURES)[number]

export const PART_LABEL: Record<FacadePart, string> = { ground: 'primer piso', upper: 'pisos de arriba', front: 'frente de arriba', gate: 'portón' }
export const MATERIAL_LABEL: Record<FacadeMaterial, string> = { panete: 'pañete', concreto: 'concreto', ladrillo: 'ladrillo', madera: 'madera', porcelanato: 'porcelanato' }
export const FEATURE_LABEL: Record<FacadeFeature, string> = {
  listones: 'listones de madera',
  jardinera: 'jardinera',
  marco_ventana: 'marco saliente',
  alero: 'alero de la losa',
  luces: 'luces de fachada',
}

export interface Cladding {
  color: string
  roughness: number
  /** foto PBR (si el visor carga texturas) */
  texture?: TextureId
  /** tinte de la foto (por defecto `color`; blanco deja el ladrillo o la madera como son) */
  tint?: string
}

export interface FacadeSpec {
  id: FacadeStyle
  name: string
  /** revestimiento del primer piso (garajes, acceso) */
  ground: Cladding
  /** revestimiento de los pisos de arriba */
  upper: Cladding
  /** fachada principal de los pisos de arriba (la del lado de los portones), si cambia */
  front?: Cladding
  /** perfilería exterior de puertas y ventanas */
  frame: string
  /** franja del borde de losa entre pisos y remate del antepecho */
  band: string
  /** marco saliente del voladizo y recuadro de las ventanas del frente */
  accent: string
  /** portón plegable del garaje */
  gate: Cladding
  /** losa de cubierta impermeabilizada */
  roof: string
  /** detalles a la vista */
  features: readonly FacadeFeature[]
  /** tiene cambios encima del estilo */
  custom?: boolean
}

/** Cómo se ve cada revestimiento (color = tinte de la foto o color liso). */
export function claddingOf(material: FacadeMaterial, color?: string | null): Cladding {
  switch (material) {
    case 'panete':
      return { color: color ?? '#f2f1ec', roughness: 0.9, texture: 'panete' }
    case 'concreto':
      return { color: color ?? '#b9b8b2', roughness: 0.85, texture: 'concreto', tint: color ?? '#d6d4cd' }
    case 'ladrillo':
      return { color: color ?? '#b4603a', roughness: 0.85, texture: 'ladrillo', tint: color ?? '#ffffff' }
    case 'madera':
      return { color: color ?? '#b07a4a', roughness: 0.6, texture: 'madera', tint: color ?? '#f3dcc4' }
    case 'porcelanato':
      return { color: color ?? '#2c2f33', roughness: 0.25 }
  }
}

const WHITE: Cladding = claddingOf('panete')

export const FACADES: Record<FacadeStyle, FacadeSpec> = {
  moderna_blanca: {
    id: 'moderna_blanca',
    name: 'Moderna blanca',
    ground: WHITE,
    upper: WHITE,
    frame: '#1f2224',
    band: '#7b7f83',
    accent: '#7b7f83',
    gate: { color: '#3a3d40', roughness: 0.45 },
    roof: '#8f9295',
    features: [],
  },
  moderna_madera: {
    id: 'moderna_madera',
    name: 'Gris y madera',
    ground: claddingOf('panete', '#4b4f53'),
    upper: claddingOf('panete', '#5a5e62'),
    front: claddingOf('madera'),
    frame: '#16181a',
    band: '#2b2e31',
    accent: '#2b2e31',
    gate: { color: '#9c6a3e', roughness: 0.55, texture: 'madera', tint: '#e6c9ab' },
    roof: '#6d7074',
    features: [],
  },
  moderna_ladrillo: {
    id: 'moderna_ladrillo',
    name: 'Ladrillo y blanco',
    ground: claddingOf('ladrillo'),
    upper: WHITE,
    frame: '#3a2f28',
    band: '#d9d6cf',
    accent: '#d9d6cf',
    gate: { color: '#2f3133', roughness: 0.5 },
    roof: '#8f9295',
    features: [],
  },
  // la propuesta para la casa de varios pisos: base de concreto, voladizo blanco enmarcado
  // en grafito, celosía de madera en el frente, jardinera, alero y apliques en el acceso
  moderna_contemporanea: {
    id: 'moderna_contemporanea',
    name: 'Contemporánea',
    ground: claddingOf('concreto'),
    upper: WHITE,
    frame: '#151618',
    band: '#3b3e42',
    accent: '#3b3e42',
    gate: { color: '#8a5d38', roughness: 0.55, texture: 'madera', tint: '#d9b896' },
    roof: '#7d8084',
    features: ['listones', 'jardinera', 'marco_ventana', 'alero', 'luces'],
  },
}

export function isFacadeStyle(v: unknown): v is FacadeStyle {
  return typeof v === 'string' && (FACADE_STYLES as readonly string[]).includes(v)
}

export function facadeSpec(style: string | null | undefined): FacadeSpec {
  return FACADES[isFacadeStyle(style) ? style : 'moderna_blanca']
}

function surface(base: Cladding, s: FacadeSurface | null | undefined): Cladding {
  if (!s || (!s.material && !s.color)) return base
  if (s.material) return claddingOf(s.material, s.color)
  // solo el color: la misma foto con otro tinte (o el color liso si no hay foto)
  return base.texture ? { ...base, color: s.color!, tint: s.color! } : { ...base, color: s.color! }
}

/** El estilo con lo que se le cambió encima. */
export function resolveFacade(style: string | null | undefined, custom?: FacadeCustom | null): FacadeSpec {
  const base = facadeSpec(style)
  if (!custom) return base
  const upper = surface(base.upper, custom.upper)
  return {
    ...base,
    ground: surface(base.ground, custom.ground),
    upper,
    // un frente propio solo si el estilo lo trae o se pidió; si no, el frente es como arriba
    front: custom.front ? surface(base.front ?? upper, custom.front) : custom.upper ? undefined : base.front,
    gate: surface(base.gate, custom.gate),
    frame: custom.frame ?? base.frame,
    band: custom.band ?? base.band,
    accent: custom.accent ?? base.accent,
    features: custom.features ?? base.features,
    custom: true,
  }
}

/** El estilo que sigue al pulsar el botón (vuelve al primero después del último). */
export function nextFacade(style: string | null | undefined): FacadeStyle {
  const i = FACADE_STYLES.indexOf(facadeSpec(style).id)
  return FACADE_STYLES[(i + 1) % FACADE_STYLES.length]!
}

// ----------------------------------------------------------------------------- cambios

/** Un cambio puntual (del chat o de la IA). */
export type FacadeEdit =
  | { style: FacadeStyle }
  | { part: FacadePart; material?: FacadeMaterial; color?: string }
  | { paint: FacadeColor; color: string }
  | { feature: FacadeFeature; on: boolean }

export interface FacadeState {
  style: FacadeStyle
  custom: FacadeCustom | null
}

const HEX = /^#[0-9a-f]{6}$/i

export function isFacadeEdit(e: unknown): e is FacadeEdit {
  if (typeof e !== 'object' || e === null) return false
  const o = e as Record<string, unknown>
  if ('style' in o) return isFacadeStyle(o.style)
  if ('part' in o) {
    const material = o.material === undefined || (FACADE_MATERIALS as readonly unknown[]).includes(o.material)
    const color = o.color === undefined || (typeof o.color === 'string' && HEX.test(o.color))
    return (FACADE_PARTS as readonly unknown[]).includes(o.part) && material && color && (o.material !== undefined || o.color !== undefined)
  }
  if ('paint' in o) return (FACADE_COLORS as readonly unknown[]).includes(o.paint) && typeof o.color === 'string' && HEX.test(o.color)
  if ('feature' in o) return (FACADE_FEATURES as readonly unknown[]).includes(o.feature) && typeof o.on === 'boolean'
  return false
}

/** Aplica un cambio: elegir un estilo empieza limpio; el resto se suma a lo ya cambiado. */
export function applyFacadeEdit(state: FacadeState, edit: FacadeEdit): FacadeState {
  if ('style' in edit) return { style: edit.style, custom: null }
  const c: FacadeCustom = { ...(state.custom ?? {}) }
  if ('part' in edit) {
    const prev = c[edit.part] ?? {}
    // otro material sin color nuevo toma el color propio del material
    c[edit.part] = edit.material ? { material: edit.material, color: edit.color ?? null } : { ...prev, color: edit.color ?? prev.color ?? null }
  } else if ('paint' in edit) {
    c[edit.paint] = edit.color
  } else {
    const now = new Set(c.features ?? facadeSpec(state.style).features)
    if (edit.on) now.add(edit.feature)
    else now.delete(edit.feature)
    c.features = FACADE_FEATURES.filter((f) => now.has(f))
  }
  return { style: state.style, custom: c }
}

/** Frase corta de lo que cambió (respuesta del chat). */
export function describeFacadeEdit(edit: FacadeEdit): string {
  if ('style' in edit) return `Fachada ${FACADES[edit.style].name.toLowerCase()}`
  if ('part' in edit) return `${PART_LABEL[edit.part][0]!.toUpperCase()}${PART_LABEL[edit.part].slice(1)} en ${edit.material ? MATERIAL_LABEL[edit.material] : 'otro color'}`
  if ('paint' in edit) return { frame: 'Marcos', band: 'Franja de losa', accent: 'Marco saliente' }[edit.paint] + ` en ${edit.color}`
  return `${edit.on ? 'Puse' : 'Quité'} ${FEATURE_ARTICLE[edit.feature]} ${FEATURE_LABEL[edit.feature]}`
}

const FEATURE_ARTICLE: Record<FacadeFeature, string> = { listones: 'los', jardinera: 'la', marco_ventana: 'el', alero: 'el', luces: 'las' }

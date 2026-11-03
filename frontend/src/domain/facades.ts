/**
 * Fachadas propuestas: cómo se ve la casa por fuera. Cada estilo viste solo el exterior
 * (una piel sobre la cara de afuera de los muros de fachada, marcos, franjas de losa,
 * antepecho y portón); el interior y la geometría del plano no cambian.
 */
import type { TextureId } from './materials'

export const FACADE_STYLES = ['moderna_blanca', 'moderna_madera', 'moderna_ladrillo'] as const
export type FacadeStyle = (typeof FACADE_STYLES)[number]

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
  /** portón plegable del garaje */
  gate: Cladding
  /** losa de cubierta impermeabilizada */
  roof: string
}

const WHITE: Cladding = { color: '#f2f1ec', roughness: 0.9, texture: 'panete' }

export const FACADES: Record<FacadeStyle, FacadeSpec> = {
  moderna_blanca: {
    id: 'moderna_blanca',
    name: 'Moderna blanca',
    ground: WHITE,
    upper: WHITE,
    frame: '#1f2224',
    band: '#7b7f83',
    gate: { color: '#3a3d40', roughness: 0.45 },
    roof: '#8f9295',
  },
  moderna_madera: {
    id: 'moderna_madera',
    name: 'Gris y madera',
    ground: { color: '#4b4f53', roughness: 0.85, texture: 'panete' },
    upper: { color: '#5a5e62', roughness: 0.85, texture: 'panete' },
    front: { color: '#b07a4a', roughness: 0.6, texture: 'madera', tint: '#f3dcc4' },
    frame: '#16181a',
    band: '#2b2e31',
    gate: { color: '#9c6a3e', roughness: 0.55, texture: 'madera', tint: '#e6c9ab' },
    roof: '#6d7074',
  },
  moderna_ladrillo: {
    id: 'moderna_ladrillo',
    name: 'Ladrillo y blanco',
    ground: { color: '#b4603a', roughness: 0.85, texture: 'ladrillo', tint: '#ffffff' },
    upper: WHITE,
    frame: '#3a2f28',
    band: '#d9d6cf',
    gate: { color: '#2f3133', roughness: 0.5 },
    roof: '#8f9295',
  },
}

export function isFacadeStyle(v: unknown): v is FacadeStyle {
  return typeof v === 'string' && (FACADE_STYLES as readonly string[]).includes(v)
}

export function facadeSpec(style: string | null | undefined): FacadeSpec {
  return FACADES[isFacadeStyle(style) ? style : 'moderna_blanca']
}

/** El estilo que sigue al pulsar el botón (vuelve al primero después del último). */
export function nextFacade(style: string | null | undefined): FacadeStyle {
  const i = FACADE_STYLES.indexOf(facadeSpec(style).id)
  return FACADE_STYLES[(i + 1) % FACADE_STYLES.length]!
}

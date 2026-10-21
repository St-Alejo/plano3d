/**
 * Acabados de muros y pisos (ADR-016). El modelo guarda solo el id; color, rugosidad
 * y patrón se resuelven en el cliente (MaterialFactory).
 */
export type Pattern = 'brick' | 'planks' | 'tiles' | null

/** Texturas PBR (fotos CC0 en public/texturas/<id>/{color,normal,rough}.webp). */
export type TextureId = 'ladrillo' | 'panete' | 'concreto' | 'madera_piso' | 'porcelanato' | 'baldosa' | 'pasto' | 'tierra' | 'madera' | 'teja'

/** Lado real de cada textura en metros: el ladrillo mide lo mismo en un muro de 1 m y en uno de 8 m. */
export const TEXTURES: Record<TextureId, { tileM: number; source: string }> = {
  ladrillo: { tileM: 1.1, source: 'ambientCG Bricks059' },
  panete: { tileM: 2, source: 'ambientCG Plaster001' },
  concreto: { tileM: 1.1, source: 'ambientCG Concrete034' },
  madera_piso: { tileM: 1.8, source: 'ambientCG WoodFloor051' },
  porcelanato: { tileM: 1, source: 'ambientCG Tiles107' },
  baldosa: { tileM: 0.8, source: 'ambientCG Tiles040' },
  pasto: { tileM: 2, source: 'ambientCG Grass005' },
  tierra: { tileM: 2.1, source: 'ambientCG Ground037' },
  madera: { tileM: 0.8, source: 'ambientCG Wood049' },
  teja: { tileM: 1.6, source: 'ambientCG RoofingTiles006' },
}

export interface MaterialSpec {
  id: string
  name: string
  color: string
  roughness: number
  pattern: Pattern
  /** foto PBR del acabado; `tint` la tiñe (pinturas sobre el mismo pañete) */
  texture?: TextureId
  tint?: string
}

export const WALL_MATERIALS: MaterialSpec[] = [
  { id: 'plaster', name: 'Pañete blanco', color: '#eef0e6', roughness: 0.9, pattern: null, texture: 'panete', tint: '#f4f3ee' },
  { id: 'pintura_arena', name: 'Pintura arena', color: '#e3d5bd', roughness: 0.85, pattern: null, texture: 'panete', tint: '#e8d9bf' },
  { id: 'pintura_verde', name: 'Pintura verde salvia', color: '#b9c4ad', roughness: 0.85, pattern: null, texture: 'panete', tint: '#bfcab2' },
  { id: 'ladrillo', name: 'Ladrillo a la vista', color: '#a65a3c', roughness: 0.95, pattern: 'brick', texture: 'ladrillo' },
  { id: 'concreto', name: 'Concreto', color: '#a7a7a1', roughness: 0.95, pattern: null, texture: 'concreto', tint: '#c4c4bd' },
]

export const FLOOR_MATERIALS: MaterialSpec[] = [
  { id: 'madera_roble', name: 'Madera roble', color: '#b08a64', roughness: 0.6, pattern: 'planks', texture: 'madera_piso' },
  { id: 'madera_oscura', name: 'Madera oscura', color: '#6f4e37', roughness: 0.55, pattern: 'planks', texture: 'madera_piso', tint: '#7a5a42' },
  { id: 'porcelanato', name: 'Porcelanato claro', color: '#d9d4c7', roughness: 0.3, pattern: 'tiles', texture: 'porcelanato', tint: '#f1ece2' },
  { id: 'baldosa_gris', name: 'Baldosa gris', color: '#9aa0a0', roughness: 0.4, pattern: 'tiles', texture: 'baldosa', tint: '#b9bebe' },
  { id: 'cemento', name: 'Cemento pulido', color: '#a3a39b', roughness: 0.7, pattern: null, texture: 'concreto', tint: '#b8b8b0' },
]

export const wallMaterial = (id: string | null | undefined): MaterialSpec | undefined => WALL_MATERIALS.find((m) => m.id === id)
export const floorMaterial = (id: string | null | undefined): MaterialSpec | undefined => FLOOR_MATERIALS.find((m) => m.id === id)

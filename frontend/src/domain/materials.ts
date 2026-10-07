/**
 * Acabados de muros y pisos (ADR-016). El modelo guarda solo el id; color, rugosidad
 * y patrón se resuelven en el cliente (MaterialFactory).
 */
export type Pattern = 'brick' | 'planks' | 'tiles' | null

export interface MaterialSpec {
  id: string
  name: string
  color: string
  roughness: number
  pattern: Pattern
}

export const WALL_MATERIALS: MaterialSpec[] = [
  { id: 'plaster', name: 'Pañete blanco', color: '#eef0e6', roughness: 0.9, pattern: null },
  { id: 'pintura_arena', name: 'Pintura arena', color: '#e3d5bd', roughness: 0.85, pattern: null },
  { id: 'pintura_verde', name: 'Pintura verde salvia', color: '#b9c4ad', roughness: 0.85, pattern: null },
  { id: 'ladrillo', name: 'Ladrillo a la vista', color: '#a65a3c', roughness: 0.95, pattern: 'brick' },
  { id: 'concreto', name: 'Concreto', color: '#a7a7a1', roughness: 0.95, pattern: null },
]

export const FLOOR_MATERIALS: MaterialSpec[] = [
  { id: 'madera_roble', name: 'Madera roble', color: '#b08a64', roughness: 0.6, pattern: 'planks' },
  { id: 'madera_oscura', name: 'Madera oscura', color: '#6f4e37', roughness: 0.55, pattern: 'planks' },
  { id: 'porcelanato', name: 'Porcelanato claro', color: '#d9d4c7', roughness: 0.3, pattern: 'tiles' },
  { id: 'baldosa_gris', name: 'Baldosa gris', color: '#9aa0a0', roughness: 0.4, pattern: 'tiles' },
  { id: 'cemento', name: 'Cemento pulido', color: '#a3a39b', roughness: 0.7, pattern: null },
]

export const wallMaterial = (id: string | null | undefined): MaterialSpec | undefined => WALL_MATERIALS.find((m) => m.id === id)
export const floorMaterial = (id: string | null | undefined): MaterialSpec | undefined => FLOOR_MATERIALS.find((m) => m.id === id)

/**
 * Pisos diseñados en Interiores 3D (ADR-024): el ambiente trae `floor_material = "int_<id>"`.
 * Se pinta al instante con el color del acabado y, si el visor carga texturas, se le ponen las
 * texturas PBR que Interiores publica en `/api/textures` (manifiesto público y con CORS).
 */
import * as THREE from 'three'
import { INTERIORES_URL } from '@/features/share/interiores'
import { INTERIORES_CATALOG_PREFIX, isInterioresItem } from './interioresModels'

/** Acabados de piso de Interiores: color base y rugosidad (los de su biblioteca). */
const FLOORS: Record<string, { color: string; roughness: number }> = {
  'wood-oak': { color: '#c8a97e', roughness: 0.7 },
  'wood-walnut': { color: '#6b4a33', roughness: 0.65 },
  'wood-ash-white': { color: '#e3d8c6', roughness: 0.7 },
  'wood-teak': { color: '#9a6a3f', roughness: 0.65 },
  'wood-herringbone': { color: '#b48a5c', roughness: 0.6 },
  'stone-marble-white': { color: '#ebe8e2', roughness: 0.25 },
  'stone-travertine': { color: '#d6c4a4', roughness: 0.6 },
  'stone-microcement': { color: '#b9b5ae', roughness: 0.8 },
  'stone-terrazzo': { color: '#ddd6cb', roughness: 0.35 },
  'stone-slate': { color: '#55585a', roughness: 0.7 },
  'ceramic-white': { color: '#f4f3ef', roughness: 0.3 },
  'ceramic-terracotta': { color: '#b8653f', roughness: 0.75 },
  'ceramic-grey-tile': { color: '#9c9b97', roughness: 0.5 },
  'ceramic-marble-mosaic': { color: '#d9d3c8', roughness: 0.3 },
  'carpet-grey': { color: '#8f8f8c', roughness: 1 },
  'carpet-cream': { color: '#e2d9c6', roughness: 1 },
}
/** Acabado propio o desconocido: un tono neutro hasta que lleguen sus texturas. */
const NEUTRAL = { color: '#cfc8bc', roughness: 0.7 }

/** `int_wood-oak` → `wood-oak`; null si el acabado no es de Interiores. */
export function interioresFloorId(materialId: string | null | undefined): string | null {
  return materialId && isInterioresItem(materialId) ? materialId.slice(INTERIORES_CATALOG_PREFIX.length) : null
}

/** Color y rugosidad del acabado, sin red. */
export function interioresFloorLook(id: string): { color: string; roughness: number } {
  return FLOORS[id] ?? NEUTRAL
}

interface TextureSet {
  sizeM: number
  avgColor?: string
  maps: { albedo: string; normal: string; arm: string }
}
interface Manifest {
  sets: Record<string, TextureSet>
  surfaces: Record<string, string>
}

export type ManifestFetcher = () => Promise<Manifest | null>

const fetchManifest: ManifestFetcher = async () => {
  const res = await fetch(`${INTERIORES_URL}/api/textures`)
  return res.ok ? ((await res.json()) as Manifest) : null
}

let manifest: Promise<Manifest | null> | null = null

/** Juego de texturas del acabado (null si Interiores no está o no lo tiene). */
export async function interioresFloorSet(id: string, fetcher: ManifestFetcher = fetchManifest): Promise<(TextureSet & { base: string }) | null> {
  manifest ??= fetcher().catch(() => null)
  const m = await manifest
  const asset = m?.surfaces[id]
  const set = asset ? m.sets[asset] : undefined
  return set ? { ...set, base: INTERIORES_URL } : null
}

/**
 * Pone las texturas PBR en el material ya creado (las UV de la escena están en metros). El ARM
 * de Interiores trae la rugosidad en el canal G, que es el que lee `roughnessMap`.
 */
export function applyInterioresTextures(material: THREE.MeshStandardMaterial, set: TextureSet & { base: string }, loader: THREE.TextureLoader): void {
  const k = 1 / set.sizeM
  const load = (url: string, color = false) => {
    const t = loader.load(`${set.base}${url}`)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(k, k)
    t.anisotropy = 8
    if (color) t.colorSpace = THREE.SRGBColorSpace
    return t
  }
  material.map = load(set.maps.albedo, true)
  material.normalMap = load(set.maps.normal)
  material.normalScale = new THREE.Vector2(0.8, 0.8)
  material.roughnessMap = load(set.maps.arm)
  material.roughness = 1
  material.color.set('#ffffff')
  material.needsUpdate = true
}

/** Solo para las pruebas: olvida el manifiesto. */
export function clearInterioresFinishes(): void {
  manifest = null
}

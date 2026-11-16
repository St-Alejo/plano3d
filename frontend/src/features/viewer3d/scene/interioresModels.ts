/**
 * Muebles que vienen de Interiores 3D (ADR-024): su `catalog_id` es `int_<id del catálogo>` y
 * su modelo real (GLB) lo sirve Interiores en `/api/catalog/<id>/model.glb`, público y con CORS.
 * Se descarga una vez por pieza y se clona para cada mueble.
 */
import * as THREE from 'three'
import { INTERIORES_URL } from '@/features/share/interiores'

export const INTERIORES_CATALOG_PREFIX = 'int_'

export const isInterioresItem = (catalogId: string) => catalogId.startsWith(INTERIORES_CATALOG_PREFIX)

/** Dirección del GLB de una pieza de Interiores. */
export function interioresModelUrl(catalogId: string, base = INTERIORES_URL): string {
  return `${base}/api/catalog/${encodeURIComponent(catalogId.slice(INTERIORES_CATALOG_PREFIX.length))}/model.glb`
}

export type ModelLoader = (url: string) => Promise<THREE.Object3D>

const cache = new Map<string, Promise<THREE.Object3D | null>>()

const gltfLoader: ModelLoader = async (url) => {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const gltf = await new GLTFLoader().loadAsync(url)
  return gltf.scene
}

/** El modelo de la pieza (null si no se pudo: el mueble se queda como caja). */
export function loadInterioresModel(catalogId: string, loader: ModelLoader = gltfLoader): Promise<THREE.Object3D | null> {
  const url = interioresModelUrl(catalogId)
  let pending = cache.get(url)
  if (!pending) {
    pending = loader(url).catch(() => null)
    cache.set(url, pending)
  }
  return pending
}

/**
 * Copia del modelo encajada en la huella del mueble: escala a ancho × alto × fondo, centrada en
 * x/z y apoyada en el piso (y = 0), con sombras y la marca para poder seleccionarlo.
 */
export function fitModel(source: THREE.Object3D, size: { width: number; depth: number; height: number }, userData: Record<string, unknown>): THREE.Object3D {
  const model = source.clone(true)
  const box = new THREE.Box3().setFromObject(model)
  const dims = box.getSize(new THREE.Vector3())
  const sx = dims.x > 1e-6 ? size.width / dims.x : 1
  const sy = dims.y > 1e-6 ? size.height / dims.y : 1
  const sz = dims.z > 1e-6 ? size.depth / dims.z : 1
  const center = box.getCenter(new THREE.Vector3())
  const wrapper = new THREE.Group()
  model.position.set(-center.x, -box.min.y, -center.z)
  wrapper.add(model)
  wrapper.scale.set(sx, sy, sz)
  wrapper.traverse((o) => {
    o.userData = { ...o.userData, ...userData }
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  return wrapper
}

/** Solo para las pruebas: olvida lo descargado. */
export function clearInterioresModels(): void {
  cache.clear()
}

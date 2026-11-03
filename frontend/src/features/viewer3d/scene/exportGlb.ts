import * as THREE from 'three'

/** Las fotos van en JPEG: pesa ~10× menos que el PNG por defecto y lo abre cualquier visor glTF. */
const IMAGE_MIME = 'image/jpeg'
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap'] as const

/**
 * Copia de la escena lista para exportar, sin tocar la del visor:
 * - cada textura se marca para salir en JPEG (salvo el color de un material con transparencia,
 *   que necesita el canal alfa);
 * - un material con mapa de rugosidad y sin metal usa ese mismo mapa como metalness. El
 *   exportador arma un mapa combinado nuevo por material cuando son distintos (una copia de la
 *   foto por cada uno); si son el mismo lo reutiliza. Con metalness 0 el resultado es igual.
 */
export function prepareForExport(root: THREE.Object3D): THREE.Object3D {
  const copy = root.clone()
  const swapped = new Map<THREE.Material, THREE.Material>()
  const prepare = (m: THREE.Material): THREE.Material => {
    const known = swapped.get(m)
    if (known) return known
    let out = m
    if (m instanceof THREE.MeshStandardMaterial) {
      for (const key of MAPS) {
        const t = m[key]
        if (!t || (key === 'map' && (m.transparent || m.alphaTest > 0))) continue
        t.userData.mimeType ??= IMAGE_MIME
      }
      if (m.roughnessMap && !m.metalnessMap && m.metalness === 0) {
        const c = m.clone()
        c.metalnessMap = m.roughnessMap
        out = c
      }
    }
    swapped.set(m, out)
    return out
  }
  copy.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    o.material = Array.isArray(o.material) ? o.material.map(prepare) : prepare(o.material)
  })
  return copy
}

/** Exporta el grupo como GLB binario (formato estándar, se abre en Blender o cualquier visor glTF). */
export async function exportGlb(root: THREE.Object3D, opts: { maxTextureSize?: number } = {}): Promise<Blob> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
  const exporter = new GLTFExporter()
  const result = await exporter.parseAsync(prepareForExport(root), { binary: true, onlyVisible: true, ...(opts.maxTextureSize ? { maxTextureSize: opts.maxTextureSize } : {}) })
  if (!(result instanceof ArrayBuffer)) throw new Error('El exportador no devolvió un GLB binario')
  return new Blob([result], { type: 'model/gltf-binary' })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

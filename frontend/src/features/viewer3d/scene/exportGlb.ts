import type * as THREE from 'three'

/** Exporta el grupo como GLB binario (formato estándar, se abre en Blender o cualquier visor glTF). */
export async function exportGlb(root: THREE.Object3D): Promise<Blob> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
  const exporter = new GLTFExporter()
  const result = await exporter.parseAsync(root, { binary: true, onlyVisible: true })
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

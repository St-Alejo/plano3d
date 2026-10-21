/**
 * Coordenadas de textura en metros. BoxGeometry trae UV de 0 a 1 por cara, así una
 * textura se estira igual en un muro de 1 m que en uno de 8 m (el aspecto "de cajas").
 * Aquí cada vértice toma su posición en el espacio del padre: las caras verticales usan
 * (largo a lo largo de la cara, altura) y las horizontales (x, z). Los tramos de un mismo
 * muro (antepecho, dintel, macizo) quedan continuos y las texturas se repiten cada `tileM`
 * metros según el material (MaterialFactory).
 */
import * as THREE from 'three'

const p = new THREE.Vector3()
const n = new THREE.Vector3()

export function worldUv(mesh: THREE.Mesh): void {
  mesh.updateMatrix()
  const g = mesh.geometry
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const uv = g.getAttribute('uv')
  if (!pos || !nor || !uv) return
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrix)
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix)
    n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize()
    if (Math.abs(n.y) > 0.7) uv.setXY(i, p.x, -p.z)
    // tangente horizontal de la cara: la textura corre a lo largo del muro
    else uv.setXY(i, p.x * n.z - p.z * n.x, p.y)
  }
  uv.needsUpdate = true
}

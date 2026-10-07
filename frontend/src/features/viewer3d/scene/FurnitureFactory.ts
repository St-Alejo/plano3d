/**
 * Factory de muebles 3D: a partir del `catalog_id` arma un grupo de primitivas con las
 * medidas del mueble colocado. Una pieza desconocida se dibuja como su caja envolvente,
 * así un modelo con muebles de un catálogo más nuevo nunca rompe el visor.
 */
import * as THREE from 'three'
import type { Furniture } from '@/api/types'
import { catalogItem, scaledParts, type Part } from '@/domain/catalog'
import type { MaterialFactory } from './MaterialFactory'

export class FurnitureFactory {
  constructor(private readonly materials: MaterialFactory) {}

  private partMesh(p: Part): THREE.Mesh {
    const geo = p.shape === 'cyl' ? new THREE.CylinderGeometry(p.w / 2, p.w / 2, p.h, 24) : new THREE.BoxGeometry(p.w, p.h, p.d)
    const mesh = new THREE.Mesh(geo, this.materials.tone(p.tone))
    mesh.position.set(p.x, p.y0 + p.h / 2, p.z)
    mesh.castShadow = p.tone !== 'glass'
    mesh.receiveShadow = true
    return mesh
  }

  create(f: Furniture, elevation = 0): THREE.Group {
    const item = catalogItem(f.catalog_id)
    const parts: Part[] = item
      ? scaledParts(item, f.width, f.depth, f.height)
      : [{ shape: 'box', x: 0, z: 0, w: f.width, d: f.depth, y0: 0, h: f.height, tone: 'soft' }]
    const group = new THREE.Group()
    for (const p of parts) {
      const mesh = this.partMesh(p)
      mesh.userData = { kind: 'furniture', furnitureId: f.id }
      group.add(mesh)
    }
    group.position.set(f.position.x, elevation, f.position.y)
    // planta (x, y) → escena (x, z): el giro en planta es el opuesto alrededor de Y
    group.rotation.y = -(f.rotation ?? 0)
    group.name = `furniture:${f.id}`
    group.userData = { kind: 'furniture', furnitureId: f.id }
    return group
  }
}
